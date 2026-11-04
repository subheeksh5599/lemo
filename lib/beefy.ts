/**
 * BEEFY finality, checked in the browser.
 *
 * This is the browser twin of `scripts/capture-beefy.mjs` and of what
 * `contracts/BeefyRootFeed.sol` runs in `submit`: every value is read from the
 * live Portaldot V3 node through the same-origin RPC proxy, and every check is
 * computed here. Nothing is fixture data.
 *
 *   1. signatures: keccak256(SCALE commitment) recovers to distinct members of
 *      the on-chain `Beefy::Authorities` (as Ethereum addresses), and at least
 *      n - floor((n-1)/3) of them signed;
 *   2. MMR root: the newest leaf SCALE((u32 N-1, blake2b256(header N-1))),
 *      appended to the `Mmr::Nodes` peaks stored at N-1, bags to the signed
 *      'mh' payload;
 *   3. header: the SCALE header of N-1 hashes (blake2b-256) to the parent hash
 *      that block N names, and its own number is N-1;
 *   4. state root: read out of those same header bytes.
 *
 * `fetchBeefyMaterial` does the reads; `verifyBeefy` is pure, so the tamper
 * view re-runs the exact checks over the same bytes with one byte flipped.
 */

import {
  blake2AsU8a,
  cryptoWaitReady,
  keccakAsU8a,
  secp256k1Expand,
  secp256k1Recover,
} from '@polkadot/util-crypto'

import { EVM_RPC, NATIVE_RPC, rpc } from '@/lib/chain'

/* ---- bytes ---------------------------------------------------------------- */

export function hexToBytes(value: string): Uint8Array {
  const body = value.startsWith('0x') ? value.slice(2) : value
  if (body.length % 2 !== 0 || /[^0-9a-fA-F]/.test(body)) throw new Error(`not hex: ${value.slice(0, 12)}`)
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '0x'
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false
  return true
}

const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

function le(bytes: Uint8Array, offset: number, length: number): bigint {
  let value = 0n
  for (let i = length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i] ?? 0)
  return value
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function u64le(value: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true)
  return out
}

/** SCALE compact, the single, two and four byte modes (< 2^30). */
export function readCompact(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset]
  if (first === undefined) throw new Error('compact past the end')
  const mode = first & 3
  if (mode === 0) return [first >> 2, offset + 1]
  if (mode === 1) return [Number(le(bytes, offset, 2) >> 2n), offset + 2]
  if (mode === 2) return [Number(le(bytes, offset, 4) >> 2n), offset + 4]
  throw new Error('big compact is not expected here')
}

export function encodeCompact(value: number): Uint8Array {
  if (value < 1 << 6) return Uint8Array.of(value << 2)
  if (value < 1 << 14) {
    const v = (value << 2) | 1
    return Uint8Array.of(v & 0xff, v >> 8)
  }
  if (value < 1 << 30) {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, ((value << 2) | 2) >>> 0, true)
    return out
  }
  throw new Error('compact above 2^30 is not expected here')
}

/* ---- SCALE: justification, header ----------------------------------------- */

export type DecodedJustification = {
  commitment: Uint8Array
  payload: { id: string; data: string }[]
  blockNumber: number
  validatorSetId: number
  mmrRoot: string
  setLength: number
  /** authority index of each signature, from the signatures_from bitfield */
  signers: number[]
  signatures: Uint8Array[]
}

/**
 * VersionedFinalityProof::V1: 0x01 ++ SCALE Commitment ++ compact signatures
 * (signatures_from bitfield MSB first, u32 validator_set_len, Vec<[u8; 65]>).
 */
export function decodeJustification(bytes: Uint8Array): DecodedJustification {
  if (bytes[0] !== 1) throw new Error(`unexpected VersionedFinalityProof version ${bytes[0]}`)
  let offset = 1
  const start = offset
  const [entries, afterEntries] = readCompact(bytes, offset)
  offset = afterEntries
  const payload: { id: string; data: string }[] = []
  for (let i = 0; i < entries; i += 1) {
    const id = String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0)
    const [length, afterLength] = readCompact(bytes, offset + 2)
    payload.push({ id, data: bytesToHex(bytes.slice(afterLength, afterLength + length)) })
    offset = afterLength + length
  }
  const blockNumber = Number(le(bytes, offset, 4))
  const validatorSetId = Number(le(bytes, offset + 4, 8))
  offset += 12
  const commitment = bytes.slice(start, offset)

  const [bitfieldLength, afterBitfield] = readCompact(bytes, offset)
  const bitfield = bytes.slice(afterBitfield, afterBitfield + bitfieldLength)
  offset = afterBitfield + bitfieldLength
  const setLength = Number(le(bytes, offset, 4))
  offset += 4
  const [count, afterCount] = readCompact(bytes, offset)
  offset = afterCount
  const signatures: Uint8Array[] = []
  for (let i = 0; i < count; i += 1) {
    signatures.push(bytes.slice(offset, offset + 65))
    offset += 65
  }
  if (offset !== bytes.length) throw new Error('trailing bytes in the justification')

  const signers: number[] = []
  for (let i = 0; i < setLength; i += 1) {
    if (((bitfield[i >> 3] ?? 0) & (0x80 >> (i & 7))) !== 0) signers.push(i)
  }
  if (signers.length !== signatures.length) throw new Error('bitfield and signature count disagree')

  const mh = payload.find((entry) => entry.id === 'mh')
  if (mh === undefined || hexToBytes(mh.data).length !== 32) throw new Error('no 32 byte mh payload')

  return { commitment, payload, blockNumber, validatorSetId, mmrRoot: mh.data, setLength, signers, signatures }
}

export type RawHeader = {
  parentHash: string
  number: string
  stateRoot: string
  extrinsicsRoot: string
  digest: { logs: string[] }
}

/** SCALE header: parent_hash | compact number | state_root | extrinsics_root | Vec<DigestItem>. */
export function encodeHeader(header: RawHeader): Uint8Array {
  const logs = header.digest.logs.map(hexToBytes)
  return concat(
    hexToBytes(header.parentHash),
    encodeCompact(Number.parseInt(header.number, 16)),
    hexToBytes(header.stateRoot),
    hexToBytes(header.extrinsicsRoot),
    encodeCompact(logs.length),
    ...logs,
  )
}

/** What BeefyRootFeed._decodeHeader reads: the compact number and the state root after it. */
export function decodeHeaderPrefix(bytes: Uint8Array): { number: number; stateRoot: string } {
  const [number, offset] = readCompact(bytes, 32)
  if (bytes.length < offset + 32) throw new Error('header ends before the state root')
  return { number, stateRoot: bytesToHex(bytes.slice(offset, offset + 32)) }
}

/* ---- MMR ------------------------------------------------------------------ */

function popcount(value: number): number {
  let count = 0
  let rest = value
  while (rest > 0) {
    count += rest & 1
    rest = Math.floor(rest / 2)
  }
  return count
}

/** ckb-merkle-mountain-range peak positions (0 based) for an MMR of `leaves`. */
export function peakPositions(leaves: number): number[] {
  const size = 2 * leaves - popcount(leaves)
  const out: number[] = []
  let height = 0
  while (2 ** (height + 1) - 1 <= size) height += 1
  let peak = 2 ** height - 1
  let accumulated = 0
  while (peak > 0) {
    if (accumulated + peak <= size) {
      out.push(accumulated + peak - 1)
      accumulated += peak
    }
    peak = (peak + 1) / 2 - 1
  }
  return out
}

/**
 * Root after appending `leafHash` to an MMR whose peaks are `peaks`, the same
 * walk as BeefyRootFeed._newestLeafRoot. Null when the peak count does not fit
 * the leaf count (the contract reverts BadEncoding there).
 */
export function newestLeafRoot(peaks: Uint8Array[], leafCountAfter: number, leafHash: Uint8Array): Uint8Array | null {
  if (leafCountAfter === 0) return null
  const stack = peaks.slice()
  let root = leafHash
  let before = leafCountAfter - 1
  while (before % 2 === 1) {
    const left = stack.pop()
    if (left === undefined) return null
    root = keccakAsU8a(concat(left, root))
    before = Math.floor(before / 2)
  }
  if (popcount(before) !== stack.length) return null
  for (let i = stack.length - 1; i >= 0; i -= 1) root = keccakAsU8a(concat(root, stack[i] as Uint8Array))
  return root
}

/** Ethereum address of a compressed secp256k1 key: keccak of the uncompressed key, last 20 bytes. */
export function ethAddress(compressed: Uint8Array): string {
  return bytesToHex(keccakAsU8a(secp256k1Expand(compressed)).slice(12))
}

/** BEEFY's threshold, the one BeefyRootFeed.quorum() returns. */
export function beefyQuorum(n: number): number {
  return n - Math.floor((n - 1) / 3)
}

/* ---- storage keys (twox128 prefixes, measured against the V3 metadata) ----- */

export const KEYS = {
  beefyAuthorities: '0x08c41974a97dbf15cfbec28365bea2da5e0621c4869aa60c02be9adcc98a0d1d',
  beefyValidatorSetId: '0x08c41974a97dbf15cfbec28365bea2da8f05bccc2f70ec66a32999c5761156be',
  mmrNumberOfLeaves: '0xa8c65209d47ee80f56b0011e8fd91f508156209906244f2341137c136774c91d',
  mmrRootHash: '0xa8c65209d47ee80f56b0011e8fd91f50d42f676807518c67bb427546ba406fa1',
  /** Mmr::Nodes, an Identity-hashed u64 map: prefix ++ u64le(position). */
  mmrNodesPrefix: '0xa8c65209d47ee80f56b0011e8fd91f50519dfc7fdad21b84f64a5310fa178ef2',
} as const

export const mmrNodeKey = (position: number) => KEYS.mmrNodesPrefix + bytesToHex(u64le(position)).slice(2)

/* ---- reads ---------------------------------------------------------------- */

const BEEF = [0x42, 0x45, 0x45, 0x46]

type RawBlock = {
  block: { header: RawHeader }
  justifications: [unknown, unknown][] | null
}

function asBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') return hexToBytes(value)
  if (Array.isArray(value)) return Uint8Array.from(value as number[])
  throw new Error('unexpected justification encoding')
}

function beefyJustification(block: RawBlock): Uint8Array | null {
  for (const [engine, data] of block.justifications ?? []) {
    if (equalBytes(asBytes(engine), Uint8Array.from(BEEF))) return asBytes(data)
  }
  return null
}

async function storage(key: string, at: string): Promise<Uint8Array> {
  const value = await rpc<string | null>(NATIVE_RPC, 'state_getStorage', [key, at])
  if (value === null) throw new Error(`no value at ${key.slice(0, 18)}… for block ${at.slice(0, 10)}…`)
  return hexToBytes(value)
}

export type BeefyMaterial = {
  /** the BEEFY finalized head the search started from */
  beefyHead: { number: number; hash: string }
  /** block N: the most recent block at or below the head that kept a BEEF justification */
  block: { number: number; hash: string; parentHash: string }
  justification: Uint8Array
  decoded: DecodedJustification
  /** Beefy::ValidatorSetId and Beefy::Authorities at N, the set that signs N */
  stateSetId: number
  authorities: Uint8Array[]
  /** Mmr::NumberOfLeaves at N and at N-1 */
  leafCount: number
  leafCountBefore: number
  /** Mmr::Nodes at N-1, left to right, and their positions */
  peaks: Uint8Array[]
  peakPositions: number[]
  /** Mmr::RootHash at N, a cross-check on the signed payload */
  rootHashAtN: string
  /** block N-1 */
  parent: { number: number; hash: string; header: RawHeader; bytes: Uint8Array }
  readAt: number
}

/**
 * Read everything `BeefyRootFeed.submit` would be given for the newest
 * BEEFY-justified block. The node keeps a justification about every eighth
 * block, so the search walks down from the BEEFY finalized head.
 */
export async function fetchBeefyMaterial(onStage?: (stage: string) => void): Promise<BeefyMaterial> {
  await cryptoWaitReady()

  onStage?.('beefy_getFinalizedHead')
  const headHash = await rpc<string>(NATIVE_RPC, 'beefy_getFinalizedHead')
  const headHeader = await rpc<RawHeader>(NATIVE_RPC, 'chain_getHeader', [headHash])
  const headNumber = Number.parseInt(headHeader.number, 16)

  let found: { number: number; hash: string; raw: RawBlock; justification: Uint8Array } | null = null
  let hash = headHash
  for (let step = 0; step < 48; step += 1) {
    onStage?.(`chain_getBlock #${headNumber - step}`)
    const raw = await rpc<RawBlock | null>(NATIVE_RPC, 'chain_getBlock', [hash])
    if (raw === null) break
    const justification = beefyJustification(raw)
    if (justification !== null) {
      found = { number: Number.parseInt(raw.block.header.number, 16), hash, raw, justification }
      break
    }
    hash = raw.block.header.parentHash
  }
  if (found === null) throw new Error(`no BEEFY justification in the 48 blocks below #${headNumber}`)

  const decoded = decodeJustification(found.justification)
  const n = found.number
  const parentHash = found.raw.block.header.parentHash

  onStage?.('Beefy::Authorities, Mmr state')
  const [setIdBytes, authorityBytes, leavesN, rootHash, parentHashByNumber, parentHeader, leavesP] =
    await Promise.all([
      storage(KEYS.beefyValidatorSetId, found.hash),
      storage(KEYS.beefyAuthorities, found.hash),
      storage(KEYS.mmrNumberOfLeaves, found.hash),
      storage(KEYS.mmrRootHash, found.hash),
      rpc<string>(NATIVE_RPC, 'chain_getBlockHash', [n - 1]),
      rpc<RawHeader>(NATIVE_RPC, 'chain_getHeader', [parentHash]),
      storage(KEYS.mmrNumberOfLeaves, parentHash),
    ])

  const [authorityCount, authorityStart] = readCompact(authorityBytes, 0)
  const authorities: Uint8Array[] = []
  for (let i = 0; i < authorityCount; i += 1) {
    authorities.push(authorityBytes.slice(authorityStart + i * 33, authorityStart + (i + 1) * 33))
  }

  const leafCountBefore = Number(le(leavesP, 0, 8))
  const positions = peakPositions(leafCountBefore)
  onStage?.(`Mmr::Nodes x${positions.length}`)
  const peaks = await Promise.all(positions.map((position) => storage(mmrNodeKey(position), parentHash)))

  return {
    beefyHead: { number: headNumber, hash: headHash },
    block: { number: n, hash: found.hash, parentHash },
    justification: found.justification,
    decoded,
    stateSetId: Number(le(setIdBytes, 0, 8)),
    authorities,
    leafCount: Number(le(leavesN, 0, 8)),
    leafCountBefore,
    peaks,
    peakPositions: positions,
    rootHashAtN: bytesToHex(rootHash),
    parent: {
      number: n - 1,
      hash: parentHashByNumber,
      header: parentHeader,
      bytes: encodeHeader(parentHeader),
    },
    readAt: Date.now(),
  }
}

/* ---- the checks ----------------------------------------------------------- */

export type Tamper = 'none' | 'signature' | 'header'

export type StepValue = {
  label: string
  value: string
  /** a native block number to link on the scanner */
  block?: number
  tone?: 'ok' | 'bad' | 'muted'
}

export type Check = { label: string; pass: boolean; detail: string }

export type StepId = 'signatures' | 'mmr' | 'header' | 'state-root'

export type BeefyStep = {
  id: StepId
  title: string
  pass: boolean
  summary: string
  checks: Check[]
  values: StepValue[]
}

export type Signer = {
  index: number
  authority: string
  recovered: string | null
  pass: boolean
}

export type BeefyVerdict = {
  tamper: Tamper
  tamperNote: string | null
  steps: BeefyStep[]
  pass: boolean
  beefyBlock: number
  headerBlock: number
  setId: number
  signers: Signer[]
  mmrRoot: string
  rebuiltRoot: string | null
  headerHash: string
  stateRoot: string | null
}

function flip(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice()
  copy[index] = (copy[index] ?? 0) ^ 0x01
  return copy
}

function recover(digest: Uint8Array, signature: Uint8Array): string | null {
  try {
    const v = signature[64] ?? 0
    const pub = secp256k1Recover(digest, signature.slice(0, 64), v >= 27 ? v - 27 : v)
    return ethAddress(pub)
  } catch {
    return null
  }
}

/**
 * The four checks over fetched bytes. Pure: the same material always gives the
 * same verdict. `tamper` flips one byte before checking: the last byte of the
 * first signature's r, or the first byte of the header's state root.
 */
export function verifyBeefy(material: BeefyMaterial, tamper: Tamper = 'none'): BeefyVerdict {
  const d = material.decoded
  const n = material.block.number

  let signatures = d.signatures
  let headerBytes = material.parent.bytes
  let tamperNote: string | null = null

  if (tamper === 'signature' && signatures.length > 0) {
    signatures = [flip(signatures[0] as Uint8Array, 31), ...signatures.slice(1)]
    tamperNote = 'byte 31 (last byte of r) of signature 0 flipped in this browser'
  }
  if (tamper === 'header') {
    const [, afterNumber] = readCompact(headerBytes, 32)
    headerBytes = flip(headerBytes, afterNumber)
    tamperNote = `byte ${afterNumber} (first byte of state_root) of header #${n - 1} flipped in this browser`
  }

  /* 1. signatures */
  const digest = keccakAsU8a(d.commitment)
  const authorityAddresses = material.authorities.map(ethAddress)
  const signers: Signer[] = d.signers.map((index, position) => {
    const authority = authorityAddresses[index] ?? '(no authority at this index)'
    const recovered = recover(digest, signatures[position] as Uint8Array)
    return { index, authority, recovered, pass: recovered !== null && sameHex(recovered, authority) }
  })
  const distinct = new Set(signers.filter((s) => s.pass).map((s) => s.authority.toLowerCase())).size
  const quorum = beefyQuorum(material.authorities.length)

  const sigChecks: Check[] = [
    {
      // The feed accepts a commitment for its stored set id or the next one,
      // signed by the stored keys (rotation is implicit in submit). The browser
      // holds Beefy::ValidatorSetId at N as the stored id.
      label: 'set id',
      pass: d.validatorSetId === material.stateSetId || d.validatorSetId === material.stateSetId + 1,
      detail: `commitment set ${d.validatorSetId}, Beefy::ValidatorSetId at #${n} is ${material.stateSetId} (current or current+1 accepted)`,
    },
    {
      label: 'set length',
      pass: d.setLength === material.authorities.length,
      detail: `justification names ${d.setLength}, Beefy::Authorities holds ${material.authorities.length}`,
    },
    ...signers.map((s, i) => ({
      label: `signature ${i}`,
      pass: s.pass,
      detail: `recovers to ${s.recovered ?? 'nothing (invalid signature)'}; authority ${s.index} is ${s.authority}`,
    })),
    {
      label: 'quorum',
      pass: distinct >= quorum,
      detail: `${distinct} distinct valid signers, n - floor((n-1)/3) = ${quorum} of ${material.authorities.length} required`,
    },
  ]

  /* 3 (computed first, the leaf needs it). header */
  const headerHash = bytesToHex(blake2AsU8a(headerBytes, 256))
  let prefix: { number: number; stateRoot: string } | null = null
  try {
    prefix = decodeHeaderPrefix(headerBytes)
  } catch {
    prefix = null
  }

  /* 2. MMR root */
  const leaf = concat(u32le(n - 1), hexToBytes(headerHash))
  const leafHash = keccakAsU8a(leaf)
  const rebuilt = newestLeafRoot(material.peaks, material.leafCount, leafHash)
  const rebuiltRoot = rebuilt === null ? null : bytesToHex(rebuilt)

  const mmrChecks: Check[] = [
    {
      label: 'leaf count',
      pass: material.leafCountBefore + 1 === material.leafCount,
      detail: `Mmr::NumberOfLeaves ${material.leafCountBefore} at #${n - 1}, ${material.leafCount} at #${n}`,
    },
    {
      label: 'rebuilt root = mh',
      pass: rebuiltRoot !== null && sameHex(rebuiltRoot, d.mmrRoot),
      detail:
        rebuiltRoot === null
          ? 'peaks do not fit the leaf count'
          : `keccak bagging of ${material.peaks.length} peaks + leaf gives ${rebuiltRoot}; signed mh is ${d.mmrRoot}`,
    },
    {
      label: 'Mmr::RootHash = mh',
      pass: sameHex(material.rootHashAtN, d.mmrRoot),
      detail: `node storage at #${n} reads ${material.rootHashAtN}`,
    },
  ]

  const headerChecks: Check[] = [
    {
      label: 'number',
      pass: prefix !== null && prefix.number === n - 1,
      detail: `header's own compact number is ${prefix?.number ?? 'unreadable'}, must be N-1 = ${n - 1}`,
    },
    {
      label: 'blake2b-256 = parent of N',
      pass: sameHex(headerHash, material.block.parentHash),
      detail: `blake2b-256(${headerBytes.length} header bytes) = ${headerHash}; block #${n} names parent ${material.block.parentHash}`,
    },
    {
      label: 'blake2b-256 = block hash',
      pass: sameHex(headerHash, material.parent.hash),
      detail: `chain_getBlockHash(${n - 1}) = ${material.parent.hash}`,
    },
  ]

  const sigPass = sigChecks.every((c) => c.pass)
  const mmrPass = mmrChecks.every((c) => c.pass)
  const headerPass = headerChecks.every((c) => c.pass)
  const accepted = sigPass && mmrPass && headerPass
  const stateRoot = prefix?.stateRoot ?? null

  const steps: BeefyStep[] = [
    {
      id: 'signatures',
      title: 'Validator signatures',
      pass: sigPass,
      summary: `${distinct} of ${material.authorities.length} BEEFY authorities signed keccak256(commitment) for #${n}, set ${d.validatorSetId}`,
      checks: sigChecks,
      values: [
        { label: 'commitment block', value: String(n), block: n },
        { label: 'commitment', value: bytesToHex(d.commitment) },
        { label: 'keccak256(commitment)', value: bytesToHex(digest) },
        ...signers.map((s, i) => ({
          label: `signer ${i} recovered`,
          value: s.recovered ?? 'invalid signature',
          tone: s.pass ? ('ok' as const) : ('bad' as const),
        })),
      ],
    },
    {
      id: 'mmr',
      title: 'MMR root',
      pass: mmrPass,
      summary: `newest leaf of #${n - 1} + ${material.peaks.length} on-chain peaks rebuild the signed mh`,
      checks: mmrChecks,
      values: [
        { label: 'signed mh', value: d.mmrRoot },
        { label: 'rebuilt root', value: rebuiltRoot ?? 'peaks do not fit', tone: mmrPass ? 'ok' : 'bad' },
        { label: 'leaf hash', value: bytesToHex(leafHash) },
        { label: 'leaf count at N', value: String(material.leafCount) },
      ],
    },
    {
      id: 'header',
      title: 'Header',
      pass: headerPass,
      summary: `header #${n - 1} hashes to the parent hash block #${n} commits to`,
      checks: headerChecks,
      values: [
        { label: 'header block', value: String(n - 1), block: n - 1 },
        { label: 'blake2b-256(header)', value: headerHash, tone: headerPass ? 'ok' : 'bad' },
        { label: 'parent hash in #' + n, value: material.block.parentHash },
      ],
    },
    {
      id: 'state-root',
      title: 'State root',
      pass: accepted && stateRoot !== null,
      summary: accepted
        ? `state_root of #${n - 1}, the value BeefyRootFeed would store as currentRoot`
        : 'rejected: an earlier check failed, so BeefyRootFeed.submit would revert',
      checks: [
        {
          label: 'all checks',
          pass: accepted,
          detail: accepted ? 'signatures, MMR root and header all hold' : 'at least one check above failed',
        },
        {
          label: 'header field = node header',
          pass: stateRoot !== null && sameHex(stateRoot, material.parent.header.stateRoot),
          detail: `read from the header bytes: ${stateRoot ?? 'unreadable'}; chain_getHeader reports ${material.parent.header.stateRoot}`,
        },
      ],
      values: [
        { label: 'state root', value: stateRoot ?? 'unreadable', block: n - 1, tone: accepted ? 'ok' : 'bad' },
      ],
    },
  ]

  return {
    tamper,
    tamperNote,
    steps,
    pass: steps.every((step) => step.pass),
    beefyBlock: n,
    headerBlock: n - 1,
    setId: d.validatorSetId,
    signers,
    mmrRoot: d.mmrRoot,
    rebuiltRoot,
    headerHash,
    stateRoot,
  }
}

/* ---- the deployed feed ----------------------------------------------------- */

export const BEEFY_FEED_ENV = 'NEXT_PUBLIC_LEMO_BEEFY_FEED'

export const BEEFY_FEED: string | null = (() => {
  const raw = (process.env.NEXT_PUBLIC_LEMO_BEEFY_FEED ?? '').trim()
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null
})()

export function isBeefyFeed(address: string | null | undefined): boolean {
  return BEEFY_FEED !== null && typeof address === 'string' && address.toLowerCase() === BEEFY_FEED
}

const selector = (signature: string) => bytesToHex(keccakAsU8a(signature).slice(0, 4))

async function call(address: string, signature: string): Promise<string> {
  return rpc<string>(EVM_RPC, 'eth_call', [{ to: address, data: selector(signature) }, 'latest'])
}

export type BeefyFeedReading = {
  address: string
  codeSize: number
  currentRoot: string
  currentBlockNumber: number
  /** optional getters: null when this build of the feed does not expose them */
  beefyBlockNumber: number | null
  validatorSetId: number | null
  authoritySetSize: number | null
  quorum: number | null
  live: boolean
  /** the node's header of currentBlockNumber, re-hashed here; null when no root yet */
  header: { hash: string; rehash: string; stateRoot: string } | null
  matches: boolean | null
}

/**
 * Reads BeefyRootFeed's getters and compares currentRoot with the header of
 * that block. Only currentRoot() and currentBlockNumber() are required; the
 * other getters are read when present, so a smaller feed ABI still renders.
 */
export async function readBeefyFeed(address: string): Promise<BeefyFeedReading> {
  await cryptoWaitReady()
  const code = await rpc<string>(EVM_RPC, 'eth_getCode', [address, 'latest'])
  const codeSize = Math.max(0, (code.length - 2) / 2)
  if (codeSize === 0) throw new Error(`no contract code at ${address}`)

  const word = async (signature: string) => BigInt(await call(address, signature))
  const optional = async (signature: string): Promise<number | null> => {
    try {
      return Number(await word(signature))
    } catch {
      return null
    }
  }

  const currentRoot = ('0x' + (await call(address, 'currentRoot()')).slice(2, 66).padStart(64, '0')).toLowerCase()
  const currentBlockNumber = Number(await word('currentBlockNumber()'))
  const beefyBlockNumber = await optional('beefyBlockNumber()')
  const validatorSetId = await optional('validatorSetId()')
  const authoritySetSize = await optional('authoritySetSize()')
  const quorum = await optional('quorum()')
  const liveWord = await optional('live()')
  const live = liveWord === null ? !/^0x0+$/.test(currentRoot) : liveWord !== 0

  let header: BeefyFeedReading['header'] = null
  let matches: boolean | null = null
  if (live) {
    const hash = await rpc<string>(NATIVE_RPC, 'chain_getBlockHash', [currentBlockNumber])
    const raw = await rpc<RawHeader>(NATIVE_RPC, 'chain_getHeader', [hash])
    const bytes = encodeHeader(raw)
    const rehash = bytesToHex(blake2AsU8a(bytes, 256))
    const stateRoot = decodeHeaderPrefix(bytes).stateRoot
    header = { hash, rehash, stateRoot }
    matches = sameHex(rehash, hash) && sameHex(stateRoot, currentRoot)
  }

  return {
    address,
    codeSize,
    currentRoot,
    currentBlockNumber,
    beefyBlockNumber,
    validatorSetId,
    authoritySetSize,
    quorum,
    live,
    header,
    matches,
  }
}
