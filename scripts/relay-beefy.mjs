/**
 * Permissionless BEEFY relayer for contracts/BeefyRootFeed.sol.
 *
 * Anyone can run this: the feed checks every byte it is given against the
 * BEEFY validators' signatures, so the relayer is trusted for liveness only.
 *
 * It reads the newest BEEFY-justified Portaldot block, builds `submit(...)`
 * calldata (commitment, signatures, header of N-1, MMR peaks, leaf count), and
 * when the feed is behind by one or more validator sets it plans the catch-up
 * in order: for every missed set s, one block signed by s. The feed accepts a
 * commitment for its stored set id or the next one and advances implicitly,
 * so walking one root per set keeps it current.
 *
 * Dry run (default): prints the plan and calldata. Nothing is sent.
 *   node scripts/relay-beefy.mjs
 *   FEED_ADDRESS=0x... node scripts/relay-beefy.mjs      # reads the feed's state first
 *   FEED_SET_ID=518 FEED_BLOCK=308000 node scripts/relay-beefy.mjs   # plan from a stated state
 *   RELAY_PLAN_OUT=plan.json ...                         # also write the plan as JSON
 *
 * Send: with BOTH RELAYER_PRIVATE_KEY and FEED_ADDRESS set, each planned call
 * is estimated with eth_estimateGas and sent as a legacy EIP-155 transaction
 * to EVM_RPC (default the Portaldot V3 test EVM endpoint), priced at
 * 2 x baseFeePerGas (V3 gas is weight-scaled; never hard-code an EVM gas
 * number there). Add --once to stop after one round; otherwise it loops every
 * RELAY_INTERVAL_S seconds (default 60).
 */

import { keccakAsU8a, secp256k1PairFromSeed, secp256k1Expand, secp256k1Sign } from '@polkadot/util-crypto'
import { hexToU8a, u8aToHex, u8aConcat, bnToU8a } from '@polkadot/util'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
import { connect, buildSubmission, findJustified } from './capture-beefy.mjs'

const EVM_RPC = process.env.EVM_RPC ?? 'https://test-evm-rpc-v3.portaldot.dev'

// ------------------------------------------------------------------ ABI (just what the feed needs)

const word = (n) => { const b = new Uint8Array(32); b.set(bnToU8a(BigInt(n), { bitLength: 256, isLe: false })); return b }
const pad32 = (u8) => { const b = new Uint8Array(Math.ceil(u8.length / 32) * 32); b.set(u8); return b }
const encBytes = (hex) => { const u = hexToU8a(hex); return u8aConcat(word(u.length), pad32(u)) }
/** Encode args given as [{ dynamic: bool, data: Uint8Array }] in ABI head/tail form. */
function encodeArgs(args) {
  const heads = []
  const tails = []
  let off = 32 * args.length
  for (const a of args) {
    if (a.dynamic) { heads.push(word(off)); tails.push(a.data); off += a.data.length } else heads.push(a.data)
  }
  return u8aConcat(...heads, ...tails)
}
const selector = (sig) => keccakAsU8a(sig).slice(0, 4)

export function encodeSubmit(s) {
  return u8aToHex(u8aConcat(
    selector('submit(bytes,bytes,bytes,bytes32[],uint256)'),
    encodeArgs([
      { dynamic: true, data: encBytes(s.commitment) },
      { dynamic: true, data: encBytes(s.signaturesPacked) },
      { dynamic: true, data: encBytes(s.header.hex) },
      { dynamic: true, data: u8aConcat(word(s.mmr.peaks.length), ...s.mmr.peaks.map((p) => hexToU8a(p))) },
      { dynamic: false, data: word(s.mmr.leafCount) },
    ]),
  ))
}

// ------------------------------------------------------------------ EVM JSON-RPC

let rpcId = 0
async function evm(method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(EVM_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      if (j.error) throw Object.assign(new Error(`${method}: ${j.error.message}`), { rpc: true })
      return j.result
    } catch (e) {
      if (e.rpc || attempt >= 3) throw e
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

async function readFeed(address) {
  const call = async (sig) => BigInt(await evm('eth_call', [{ to: address, data: u8aToHex(selector(sig)) }, 'latest']))
  return { setId: Number(await call('validatorSetId()')), block: Number(await call('currentBlockNumber()')) }
}

// ------------------------------------------------------------------ legacy EIP-155 signing

function rlp(item) {
  const len = (n, off) => {
    if (n < 56) return Uint8Array.of(off + n)
    const b = hexToU8a('0x' + (n.toString(16).length % 2 ? '0' : '') + n.toString(16))
    return u8aConcat(Uint8Array.of(off + 55 + b.length), b)
  }
  if (Array.isArray(item)) { const body = u8aConcat(...item.map(rlp)); return u8aConcat(len(body.length, 0xc0), body) }
  if (item.length === 1 && item[0] < 0x80) return item
  return u8aConcat(len(item.length, 0x80), item)
}
const qty = (n) => { n = BigInt(n); if (n === 0n) return new Uint8Array(0); let h = n.toString(16); if (h.length % 2) h = '0' + h; return hexToU8a('0x' + h) }
const strip = (u8) => { let i = 0; while (i < u8.length && u8[i] === 0) i++; return u8.slice(i) }

export function evmAddressOf(secretKey) {
  const pair = secp256k1PairFromSeed(secretKey)
  return u8aToHex(keccakAsU8a(secp256k1Expand(pair.publicKey)).slice(12))
}

/** Sign a legacy EIP-155 transaction; returns the raw signed bytes as hex. */
export function signLegacyTx({ nonce, gasPrice, gas, to, data, chainId }, secretKey) {
  const fields = [qty(nonce), qty(gasPrice), qty(gas), hexToU8a(to), qty(0), hexToU8a(data)]
  const unsigned = rlp([...fields, qty(chainId), qty(0), qty(0)])
  const sig = secp256k1Sign(unsigned, secp256k1PairFromSeed(secretKey), 'keccak')
  const v = BigInt(sig[64]) + BigInt(chainId) * 2n + 35n
  return u8aToHex(rlp([...fields, qty(v), strip(sig.slice(0, 32)), strip(sig.slice(32, 64))]))
}

async function send(to, data, secretKey) {
  const from = evmAddressOf(secretKey)
  const chainId = BigInt(await evm('eth_chainId', []))
  const nonce = BigInt(await evm('eth_getTransactionCount', [from, 'pending']))
  const latest = await evm('eth_getBlockByNumber', ['latest', false])
  const gasPrice = BigInt(latest.baseFeePerGas ?? '0x3b9aca00') * 2n
  const gas = (BigInt(await evm('eth_estimateGas', [{ from, to, data }])) * 12n) / 10n
  const raw = signLegacyTx({ nonce, gasPrice, gas, to, data, chainId }, secretKey)
  const hash = await evm('eth_sendRawTransaction', [raw])
  console.log(`  sent ${hash} (gas ${gas}, gasPrice ${gasPrice})`)
  for (let i = 0; i < 60; i++) {
    const r = await evm('eth_getTransactionReceipt', [hash])
    if (r) { if (r.status !== '0x1') throw new Error(`tx ${hash} reverted`); console.log(`  included in EVM block ${BigInt(r.blockNumber)}`); return }
    await new Promise((res) => setTimeout(res, 3000))
  }
  throw new Error(`tx ${hash} not included after 180 s`)
}

// ------------------------------------------------------------------ planning

async function setIdAt(api, n) {
  return (await (await api.at(await api.rpc.chain.getBlockHash(n))).query.beefy.validatorSetId()).toNumber()
}

/** First block whose state reports validatorSetId >= target, in (lo, hi]. */
async function firstBlockOfSet(api, target, lo, hi) {
  while (hi - lo > 1) {
    const m = Math.floor((lo + hi) / 2)
    if ((await setIdAt(api, m)) >= target) hi = m
    else lo = m
  }
  return hi
}

/**
 * Calls that move a feed at (setId, block) to the newest BEEFY-justified
 * block. Each step is { kind, note, data }.
 */
export async function plan(api, feed) {
  const head = (await api.rpc.chain.getHeader(await api.rpc.beefy.getFinalizedHead())).number.toNumber()
  const chainSet = await setIdAt(api, head)
  const steps = []
  let { setId, block } = feed
  if (setId > chainSet) throw new Error(`feed set ${setId} is ahead of the chain (${chainSet})`)
  while (setId < chainSet) {
    // One justified block signed by setId+1: between the first block of that
    // set and the last block before the set after it.
    const next = setId + 1
    const lo = Math.max(block, head - 600 * (chainSet - setId + 2))
    const start = await firstBlockOfSet(api, next, lo, head)
    const end = next < chainSet ? (await firstBlockOfSet(api, next + 1, start, head)) - 1 : head
    let j
    try {
      // floor is exclusive: start itself may carry the justification
      j = await findJustified(api, end, Math.max(block, start - 1))
    } catch (e) {
      // The newest set has no justified block yet (it just rotated): plan
      // what is possible now; the next round picks it up.
      if (next === chainSet) break
      throw e
    }
    const s = await buildSubmission(api, j.number)
    if (s.validatorSetId !== next) throw new Error(`block ${j.number} is signed by ${s.validatorSetId}, expected ${next}`)
    steps.push({ kind: 'submit', note: `BEEFY block ${j.number} (set ${next}, advances the feed) -> root of ${s.header.number}`, block: s.header.number, stateRoot: s.header.stateRoot, data: encodeSubmit(s) })
    block = s.header.number
    setId = next
  }
  const latest = setId === chainSet ? await findJustified(api, head) : null
  if (latest !== null && latest.number - 1 > block) {
    const s = await buildSubmission(api, latest.number)
    steps.push({ kind: 'submit', note: `BEEFY block ${latest.number} (set ${s.validatorSetId}) -> root ${s.header.stateRoot} of ${s.header.number}`, block: s.header.number, stateRoot: s.header.stateRoot, data: encodeSubmit(s) })
  }
  steps.finalSetId = setId
  return steps
}

async function round(api) {
  const feedAddress = process.env.FEED_ADDRESS
  let feed
  if (feedAddress) feed = await readFeed(feedAddress)
  else if (process.env.FEED_SET_ID) feed = { setId: Number(process.env.FEED_SET_ID), block: Number(process.env.FEED_BLOCK ?? 0) }
  else {
    const head = (await api.rpc.chain.getHeader(await api.rpc.beefy.getFinalizedHead())).number.toNumber()
    feed = { setId: await setIdAt(api, head), block: 0 }
  }
  console.log(`feed ${feedAddress ?? '(not deployed: planning from stated state)'} set ${feed.setId} block ${feed.block}`)
  const steps = await plan(api, feed)
  if (process.env.RELAY_PLAN_OUT) {
    // A record of exactly what would be sent, for replay in a forge test.
    writeFileSync(process.env.RELAY_PLAN_OUT, JSON.stringify({ capturedAt: new Date().toISOString(), feed, count: steps.length, finalSetId: steps.finalSetId, steps }, null, 2) + '\n')
    console.log('wrote plan', process.env.RELAY_PLAN_OUT)
  }
  if (steps.length === 0) console.log('feed is current')
  const key = process.env.RELAYER_PRIVATE_KEY
  for (const st of steps) {
    console.log(`${st.kind}: ${st.note} (${(st.data.length - 2) / 2} bytes calldata)`)
    if (key && feedAddress) await send(feedAddress, st.data, hexToU8a(key))
    else console.log(`  to: ${feedAddress ?? '<FEED_ADDRESS>'}\n  data: ${st.data}`)
  }
  if (!(key && feedAddress)) console.log('dry run: set RELAYER_PRIVATE_KEY and FEED_ADDRESS to send')
}

async function main() {
  const api = await connect()
  try {
    const loop = !process.argv.includes('--once') && process.env.RELAYER_PRIVATE_KEY && process.env.FEED_ADDRESS
    do {
      await round(api)
      if (loop) await new Promise((r) => setTimeout(r, 1000 * Number(process.env.RELAY_INTERVAL_S ?? 60)))
    } while (loop)
  } finally {
    await api.disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
