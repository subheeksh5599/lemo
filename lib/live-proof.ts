/**
 * Native state, proven inside the Portaldot EVM, live.
 *
 * 1. The root: `BeefyRootFeed.currentRoot()` on the Revive EVM. It got there
 *    only with both BEEFY validators' signatures (see lib/beefy.ts).
 * 2. The proof: `state_getReadProof` for a native storage key at the block that
 *    root belongs to.
 * 3. The verdict: `SubstrateTrieVerifier.verify(root, key, nodes)` executed by
 *    the deployed contract through `eth_call`. The browser does not decide; the
 *    contract does, and returns the proven bytes.
 *
 * The same module builds `BeefyRootFeed.submit` calldata from live BEEFY
 * material so anyone can ask the server relayer to advance the feed.
 */

import { blake2AsU8a, cryptoWaitReady, decodeAddress, keccakAsU8a, xxhashAsU8a } from '@polkadot/util-crypto'

import { BEEFY_FEED, bytesToHex, hexToBytes, readBeefyFeed, type BeefyFeedReading, type BeefyMaterial } from '@/lib/beefy'
import { EVM_RPC, NATIVE_RPC, rpc } from '@/lib/chain'

/* ---- ABI, just what these two calls need --------------------------------- */

export function word(value: bigint | number): Uint8Array {
  const out = new Uint8Array(32)
  let v = BigInt(value)
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function padded(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 32) * 32)
  out.set(bytes)
  return out
}

export const encBytes = (bytes: Uint8Array) => concat(word(bytes.length), padded(bytes))

export function encBytesArray(items: Uint8Array[]): Uint8Array {
  const tails = items.map(encBytes)
  const heads: Uint8Array[] = []
  let offset = 32 * items.length
  for (const tail of tails) {
    heads.push(word(offset))
    offset += tail.length
  }
  return concat(word(items.length), ...heads, ...tails)
}

type Arg = { dynamic: boolean; data: Uint8Array }

export function encodeArgs(args: Arg[]): Uint8Array {
  const heads: Uint8Array[] = []
  const tails: Uint8Array[] = []
  let offset = 32 * args.length
  for (const arg of args) {
    if (arg.dynamic) {
      heads.push(word(offset))
      tails.push(arg.data)
      offset += arg.data.length
    } else heads.push(arg.data)
  }
  return concat(...heads, ...tails)
}

export const selector = (signature: string) => keccakAsU8a(signature).slice(0, 4)

export const SUBMIT_SELECTOR = bytesToHex(selector('submit(bytes,bytes,bytes,bytes32[],uint256)'))

/** `BeefyRootFeed.submit` calldata for live BEEFY material. */
export function encodeSubmit(material: BeefyMaterial): string {
  const d = material.decoded
  return bytesToHex(
    concat(
      selector('submit(bytes,bytes,bytes,bytes32[],uint256)'),
      encodeArgs([
        { dynamic: true, data: encBytes(d.commitment) },
        { dynamic: true, data: encBytes(concat(...d.signatures)) },
        { dynamic: true, data: encBytes(material.parent.bytes) },
        { dynamic: true, data: concat(word(material.peaks.length), ...material.peaks) },
        { dynamic: false, data: word(material.leafCount) },
      ]),
    ),
  )
}

/* ---- the native key ------------------------------------------------------- */

/** System.Account: twox128("System") ++ twox128("Account") ++ blake2_128(id) ++ id. */
export function systemAccountKey(ss58: string): { key: string; accountId: string } {
  const id = decodeAddress(ss58)
  const key = concat(
    xxhashAsU8a('System', 128),
    xxhashAsU8a('Account', 128),
    blake2AsU8a(id, 128),
    id,
  )
  return { key: bytesToHex(key), accountId: bytesToHex(id) }
}

function u128le(bytes: Uint8Array, offset: number): bigint {
  let v = 0n
  for (let i = 15; i >= 0; i -= 1) v = (v << 8n) | BigInt(bytes[offset + i] ?? 0)
  return v
}

/** AccountInfo: nonce, consumers, providers, sufficients (u32 each), then free, reserved, frozen (u128). */
export function decodeAccountInfo(bytes: Uint8Array): { nonce: number; free: bigint; reserved: bigint } {
  if (bytes.length < 16 + 48) throw new Error(`AccountInfo is ${bytes.length} bytes, expected at least 64`)
  const nonce = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
  return { nonce, free: u128le(bytes, 16), reserved: u128le(bytes, 32) }
}

/* ---- the on-chain verdict ------------------------------------------------- */

export const VERIFIER: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_LEMO_VERIFIER ?? '').trim()
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : null
})()

/** SubstrateTrieVerifier.Status, in declaration order. */
export const STATUS = ['NONE', 'PROVEN', 'ABSENT', 'INCOMPLETE', 'INVALID', 'ROOT_MISMATCH', 'VALUE_MISMATCH'] as const

function decodeVerify(result: string): { status: number; value: Uint8Array } {
  const bytes = hexToBytes(result)
  if (bytes.length < 96) throw new Error('verify returned too few bytes')
  const status = bytes[31] ?? 0
  const offset = Number(BigInt(bytesToHex(bytes.slice(32, 64))))
  const length = Number(BigInt(bytesToHex(bytes.slice(offset, offset + 32))))
  return { status, value: bytes.slice(offset + 32, offset + 32 + length) }
}

export type AccountProof = {
  ss58: string
  accountId: string
  feed: BeefyFeedReading
  blockHash: string
  key: string
  nodes: string[]
  tampered: boolean
  /** the contract's own verdict */
  status: (typeof STATUS)[number]
  provenValue: string
  proven: { nonce: number; free: bigint; reserved: bigint } | null
  /** the node's own answer at the same block, for comparison */
  native: { nonce: number; free: bigint; reserved: bigint } | null
  matches: boolean
  verifier: string
  calldataBytes: number
}

/**
 * Prove `ss58`'s System.Account record against the feed's current root, with
 * the deployed verifier as the judge. `tamper` flips one byte of the first
 * proof node before the call.
 */
export async function proveAccount(ss58: string, tamper = false): Promise<AccountProof> {
  await cryptoWaitReady()
  if (BEEFY_FEED === null) throw new Error('NEXT_PUBLIC_LEMO_BEEFY_FEED is not set in this build')
  if (VERIFIER === null) throw new Error('NEXT_PUBLIC_LEMO_VERIFIER is not set in this build')

  const { key, accountId } = systemAccountKey(ss58)
  const feed = await readBeefyFeed(BEEFY_FEED)
  if (!feed.live) throw new Error('the feed has no root yet')

  const blockHash = await rpc<string>(NATIVE_RPC, 'chain_getBlockHash', [feed.currentBlockNumber])
  const [proof, raw] = await Promise.all([
    rpc<{ proof: string[] }>(NATIVE_RPC, 'state_getReadProof', [[key], blockHash]),
    rpc<string | null>(NATIVE_RPC, 'state_getStorage', [key, blockHash]),
  ])

  let nodes = proof.proof.map(hexToBytes)
  if (tamper && nodes.length > 0) {
    const first = (nodes[0] as Uint8Array).slice()
    first[first.length - 1] = (first[first.length - 1] ?? 0) ^ 0x01
    nodes = [first, ...nodes.slice(1)]
  }

  const data = bytesToHex(
    concat(
      selector('verify(bytes32,bytes,bytes[])'),
      encodeArgs([
        { dynamic: false, data: hexToBytes(feed.currentRoot) },
        { dynamic: true, data: encBytes(hexToBytes(key)) },
        { dynamic: true, data: encBytesArray(nodes) },
      ]),
    ),
  )
  const result = await rpc<string>(EVM_RPC, 'eth_call', [{ to: VERIFIER, data }, 'latest'])
  const verdict = decodeVerify(result)
  const status = STATUS[verdict.status] ?? 'NONE'

  let proven: AccountProof['proven'] = null
  if (status === 'PROVEN') {
    try {
      proven = decodeAccountInfo(verdict.value)
    } catch {
      proven = null
    }
  }
  const native = raw === null ? null : decodeAccountInfo(hexToBytes(raw))
  const matches =
    status === 'PROVEN' && raw !== null && bytesToHex(verdict.value).toLowerCase() === raw.toLowerCase()

  return {
    ss58,
    accountId,
    feed,
    blockHash,
    key,
    nodes: nodes.map(bytesToHex),
    tampered: tamper,
    status,
    provenValue: bytesToHex(verdict.value),
    proven,
    native,
    matches,
    verifier: VERIFIER,
    calldataBytes: (data.length - 2) / 2,
  }
}

/* ---- the relay request ---------------------------------------------------- */

export type RelayResult =
  | { status: 'sent'; hash: string; block: number; root: string; rootBlock: number; setId: number }
  | { status: 'current'; behind: number; rootBlock: number }
  | { status: 'refused'; reason: string }

export type RelayPlan = {
  feed: { setId: number; block: number }
  finalSetId: number
  steps: { note: string; block: number; stateRoot: string; data: string }[]
}

/**
 * The submissions that bring the feed current: one per validator set it missed,
 * then the newest root. Planned server-side by the same code as the scheduled
 * relayer; the feed itself checks every byte against the validators' signatures.
 */
export async function fetchPlan(): Promise<RelayPlan> {
  const response = await fetch('/api/relay/next', { cache: 'no-store' })
  const body = (await response.json().catch(() => null)) as (RelayPlan & { error?: string }) | null
  if (!response.ok || body === null || !Array.isArray(body.steps)) {
    throw new Error(body?.error ?? `planning failed: HTTP ${response.status}`)
  }
  return body
}

/** Ask the server relayer to submit the given calldata to the feed. */
export async function requestRelay(calldata: string): Promise<RelayResult> {
  const response = await fetch('/api/relay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: calldata }),
  })
  const body = (await response.json().catch(() => null)) as RelayResult | { error?: string } | null
  if (body !== null && 'status' in body) return body
  return { status: 'refused', reason: (body as { error?: string } | null)?.error ?? `HTTP ${response.status}` }
}

export function formatPot(planck: bigint): string {
  const whole = planck / 10n ** 14n
  const frac = (planck % 10n ** 14n).toString().padStart(14, '0').slice(0, 4)
  return `${whole.toLocaleString('en-US')}.${frac}`
}
