import { NextResponse } from 'next/server'
import { cryptoWaitReady, keccakAsU8a, secp256k1Expand, secp256k1PairFromSeed, secp256k1Sign } from '@polkadot/util-crypto'
import { hexToU8a, u8aConcat, u8aToHex } from '@polkadot/util'

/**
 * Server relayer for BeefyRootFeed. Anyone may press "Advance the feed" in the
 * console; the browser builds `submit(...)` calldata from live BEEFY material
 * and posts it here. This route only pays gas. It cannot choose a root:
 *
 *  - it forwards calldata whose selector is `submit(bytes,bytes,bytes,bytes32[],uint256)`
 *    and only to the configured feed;
 *  - it runs `eth_estimateGas` first, and the feed reverts on anything the
 *    validators did not sign, so a forged or stale submission costs nothing;
 *  - it refuses while the feed is within COOLDOWN_BLOCKS of the chain head,
 *    which bounds spend to one submission per ~3 minutes however often it is
 *    called.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const EVM_RPC = process.env.NEXT_PUBLIC_EVM_RPC?.startsWith('http')
  ? process.env.NEXT_PUBLIC_EVM_RPC
  : 'https://test-evm-rpc-v3.portaldot.dev'
const FEED = (process.env.NEXT_PUBLIC_LEMO_BEEFY_FEED ?? '').trim()
const COOLDOWN_BLOCKS = 30
const SUBMIT = u8aToHex(keccakAsU8a('submit(bytes,bytes,bytes,bytes32[],uint256)').slice(0, 4))

let id = 0
async function evm<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(EVM_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { result?: T; error?: { message?: string } }
      if (body.error) throw Object.assign(new Error(body.error.message ?? 'rpc error'), { rpc: true })
      return body.result as T
    } catch (error) {
      if ((error as { rpc?: boolean }).rpc || attempt >= 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
}

function rlp(item: Uint8Array | Uint8Array[]): Uint8Array {
  const length = (n: number, offset: number) => {
    if (n < 56) return Uint8Array.of(offset + n)
    let hex = n.toString(16)
    if (hex.length % 2) hex = `0${hex}`
    const b = hexToU8a(`0x${hex}`)
    return u8aConcat(Uint8Array.of(offset + 55 + b.length), b)
  }
  if (Array.isArray(item)) {
    const body = u8aConcat(...item.map((part) => rlp(part)))
    return u8aConcat(length(body.length, 0xc0), body)
  }
  if (item.length === 1 && (item[0] ?? 0) < 0x80) return item
  return u8aConcat(length(item.length, 0x80), item)
}

function qty(value: bigint | number): Uint8Array {
  const n = BigInt(value)
  if (n === 0n) return new Uint8Array(0)
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  return hexToU8a(`0x${hex}`)
}

function strip(bytes: Uint8Array): Uint8Array {
  let i = 0
  while (i < bytes.length && bytes[i] === 0) i += 1
  return bytes.slice(i)
}

const word = (hex: string, index: number) => BigInt(`0x${hex.slice(2 + index * 64, 2 + (index + 1) * 64) || '0'}`)

async function readFeed() {
  const call = (signature: string) =>
    evm<string>('eth_call', [{ to: FEED, data: u8aToHex(keccakAsU8a(signature).slice(0, 4)) }, 'latest'])
  const [root, block, setId] = await Promise.all([
    call('currentRoot()'),
    call('currentBlockNumber()'),
    call('validatorSetId()'),
  ])
  return { root: `0x${root.slice(2, 66)}`, block: Number(word(block, 0)), setId: Number(word(setId, 0)) }
}

export async function POST(request: Request) {
  const key = process.env.RELAYER_PRIVATE_KEY ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(FEED) || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return NextResponse.json({ status: 'refused', reason: 'the server relayer is not configured' }, { status: 503 })
  }

  let data = ''
  try {
    const body = (await request.json()) as { data?: unknown }
    data = typeof body.data === 'string' ? body.data : ''
  } catch {
    return NextResponse.json({ status: 'refused', reason: 'invalid JSON' }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length > 16_000 || !data.toLowerCase().startsWith(SUBMIT)) {
    return NextResponse.json({ status: 'refused', reason: 'only BeefyRootFeed.submit calldata is relayed' }, { status: 400 })
  }

  try {
    await cryptoWaitReady()
    const before = await readFeed()
    const head = Number(BigInt(await evm<string>('eth_blockNumber', [])))
    const behind = head - before.block
    if (behind < COOLDOWN_BLOCKS) {
      return NextResponse.json({ status: 'current', behind, rootBlock: before.block })
    }

    const pair = secp256k1PairFromSeed(hexToU8a(key))
    const from = u8aToHex(keccakAsU8a(secp256k1Expand(pair.publicKey)).slice(12))

    let gas: bigint
    try {
      gas = (BigInt(await evm<string>('eth_estimateGas', [{ from, to: FEED, data }])) * 12n) / 10n
    } catch (error) {
      // The feed refused the bytes: unsigned, stale or tampered. Nothing is sent.
      return NextResponse.json(
        { status: 'refused', reason: `the feed rejects this submission: ${(error as Error).message}` },
        { status: 422 },
      )
    }

    const [chainId, nonce, latest] = await Promise.all([
      evm<string>('eth_chainId', []),
      evm<string>('eth_getTransactionCount', [from, 'pending']),
      evm<{ baseFeePerGas?: string }>('eth_getBlockByNumber', ['latest', false]),
    ])
    const gasPrice = BigInt(latest.baseFeePerGas ?? '0x3b9aca00') * 2n
    const chain = BigInt(chainId)
    const fields = [qty(BigInt(nonce)), qty(gasPrice), qty(gas), hexToU8a(FEED), qty(0), hexToU8a(data)]
    const signature = secp256k1Sign(rlp([...fields, qty(chain), qty(0), qty(0)]), pair, 'keccak')
    const v = BigInt(signature[64] ?? 0) + chain * 2n + 35n
    const raw = u8aToHex(rlp([...fields, qty(v), strip(signature.slice(0, 32)), strip(signature.slice(32, 64))]))
    const hash = await evm<string>('eth_sendRawTransaction', [raw])

    for (let poll = 0; poll < 15; poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const receipt = await evm<{ status: string; blockNumber: string } | null>('eth_getTransactionReceipt', [hash])
      if (receipt !== null) {
        if (receipt.status !== '0x1') {
          return NextResponse.json({ status: 'refused', reason: `transaction ${hash} reverted` }, { status: 502 })
        }
        const after = await readFeed()
        return NextResponse.json({
          status: 'sent',
          hash,
          block: Number(BigInt(receipt.blockNumber)),
          root: after.root,
          rootBlock: after.block,
          setId: after.setId,
        })
      }
    }
    return NextResponse.json({ status: 'refused', reason: `transaction ${hash} sent, not yet included` }, { status: 504 })
  } catch (error) {
    return NextResponse.json({ status: 'refused', reason: (error as Error).message }, { status: 502 })
  }
}
