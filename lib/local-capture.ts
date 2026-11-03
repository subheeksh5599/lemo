/**
 * One committed capture from a local LEMO devnet, loaded and verified here.
 *
 * The fixture under fixtures/lemo-local-capture.json was read from a solochain
 * node running at 127.0.0.1:9944. It is a local development chain, not
 * Portaldot: nothing in this module talks to a node, and nothing here is a
 * claim about a public network. The bytes are the evidence, so the page
 * re-runs the trie walk over the committed proof instead of trusting the
 * numbers the fixture carries.
 *
 * Canonical value layout: the capture stores the title record as ten 32 byte
 * words, each a big endian integer or a fixed width id, right aligned.
 *
 *   word 0   title id
 *   word 1   chain id
 *   word 2   native asset id
 *   word 3   backing reference
 *   word 4   owner word
 *   word 5   identity hash
 *   word 6   vesting hash
 *   word 7   permissions hash
 *   word 8   EVM contract, 20 bytes in the low end
 *   word 9   revision
 *
 * That is 320 bytes, which is what the hex measures. The fixture's own
 * `canonicalValueBytes` field is checked against the measurement; a
 * disagreement stays visible as a warning.
 */

import { decodeAddress } from '@polkadot/util-crypto'

import fixtureJson from '@/fixtures/lemo-local-capture.json'
import { fromHex, toHex, verifyProof, type ProofVerification } from '@/lib/proofs'

/** What the record is expected to weigh: ten 32 byte words. */
export const CANONICAL_RECORD_BYTES = 320

const WORD_BYTES = 32

export type LocalCaptureHeader = {
  number: number
  hash: string
  parentHash: string
  stateRoot: string
}

export type LocalCaptureRecord = {
  titleId: string
  /** the fixture prints this with thousands separators */
  chainId: string
  nativeAsset: string
  backing: string
  owner: string
  identityHash: string
  vestingHash: string
  permissionsHash: string
  evmContract: string
  revision: string
}

export type LocalCaptureFixture = {
  source: string
  endpoint: string
  chain: string
  runtime: {
    specName: string
    implName: string
    specVersion: string
    stateVersion: string
  }
  genesis: string
  finalized: LocalCaptureHeader
  titleId: string
  storageKey: string
  value: string
  valueBytes: number
  proofNodes: string[]
  canonicalStorageKey: string
  canonicalValue: string
  canonicalValueBytes: number
  canonicalProofNodes: string[]
  record: LocalCaptureRecord
  representationLive: boolean
  capturedAt: string
}

export type CanonicalRecord = {
  byteLength: number
  wordCount: number
  titleId: string
  chainId: bigint
  /** the same number the way the fixture prints it */
  chainIdLabel: string
  nativeAsset: string
  backing: string
  /** the whole 32 byte word, as stored */
  ownerWord: string
  /** the address sized part the word actually carries */
  ownerLow20: string
  identityHash: string
  vestingHash: string
  permissionsHash: string
  evmContract: string
  revision: bigint
}

export type CheckTone = 'ok' | 'warn' | 'bad'

export type CaptureCheck = {
  label: string
  detail: string
  tone: CheckTone
}

export type LocalCaptureReport = {
  fixture: LocalCaptureFixture
  proof: ProofVerification
  record: CanonicalRecord
  checks: CaptureCheck[]
  /** measured from the hex, never read from fixture metadata */
  valueBytes: number
  /** what the fixture claims, kept so a disagreement stays visible */
  declaredValueBytes: number
  ok: boolean
}

function bigFromWord(word: Uint8Array): bigint {
  let total = 0n
  for (const byte of word) total = (total << 8n) | BigInt(byte)
  return total
}

function groupThousands(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Reads the canonical value as ten aligned words. A length that is not a whole
 * number of words is a fixture error, not a reading, so it throws.
 */
export function decodeCanonicalRecord(hex: string): CanonicalRecord {
  const bytes = fromHex(hex)

  if (bytes.length % WORD_BYTES !== 0) {
    throw new Error(
      `the canonical value is ${bytes.length} bytes, which is not a whole number of ${WORD_BYTES} byte words`,
    )
  }

  const word = (index: number) => bytes.subarray(index * WORD_BYTES, (index + 1) * WORD_BYTES)
  const wordCount = bytes.length / WORD_BYTES

  if (wordCount < 10) {
    throw new Error(`the canonical value carries ${wordCount} words, the record needs ten`)
  }

  const chainId = bigFromWord(word(1))
  const owner = word(4)
  const evm = word(8)

  return {
    byteLength: bytes.length,
    wordCount,
    titleId: toHex(word(0)),
    chainId,
    chainIdLabel: groupThousands(chainId),
    nativeAsset: toHex(word(2)),
    backing: toHex(word(3)),
    ownerWord: toHex(owner),
    ownerLow20: toHex(owner.subarray(12)),
    identityHash: toHex(word(5)),
    vestingHash: toHex(word(6)),
    permissionsHash: toHex(word(7)),
    evmContract: toHex(evm.subarray(12)),
    revision: bigFromWord(word(9)),
  }
}

function parseNumber(value: string): bigint | null {
  const digits = value.replace(/[^0-9]/g, '')
  if (digits.length === 0) return null
  return BigInt(digits)
}

const HEX = /^0x[0-9a-fA-F]*$/

function requireHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX.test(value) || value.length % 2 !== 0) {
    throw new Error(`the fixture field ${field} is not an even length hex string`)
  }
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`the fixture field ${field} is missing`)
  }
  return value
}

function requireHexList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`the fixture field ${field} is not a non-empty list of nodes`)
  }
  return value.map((node, index) => requireHex(node, `${field}[${index}]`))
}

/**
 * Shape check only. It reads no number it does not have to, and it never
 * rewrites the capture: a malformed fixture is reported, not repaired.
 */
export function parseFixture(raw: unknown): LocalCaptureFixture {
  if (typeof raw !== 'object' || raw === null) throw new Error('the fixture is not an object')

  const value = raw as Record<string, unknown>
  const finalized = value.finalized
  const record = value.record
  const runtime = value.runtime

  if (typeof finalized !== 'object' || finalized === null) {
    throw new Error('the fixture has no finalized header')
  }
  if (typeof record !== 'object' || record === null) {
    throw new Error('the fixture has no record')
  }

  const header = finalized as Record<string, unknown>
  if (typeof header.number !== 'number' || !Number.isFinite(header.number)) {
    throw new Error('the finalized header has no block number')
  }

  const fields = record as Record<string, unknown>

  return {
    source: requireString(value.source, 'source'),
    endpoint: requireString(value.endpoint, 'endpoint'),
    chain: requireString(value.chain, 'chain'),
    runtime: {
      specName: requireString((runtime as Record<string, unknown> | null)?.specName, 'runtime.specName'),
      implName: requireString((runtime as Record<string, unknown> | null)?.implName, 'runtime.implName'),
      specVersion: requireString(
        (runtime as Record<string, unknown> | null)?.specVersion,
        'runtime.specVersion',
      ),
      stateVersion: requireString(
        (runtime as Record<string, unknown> | null)?.stateVersion,
        'runtime.stateVersion',
      ),
    },
    genesis: requireHex(value.genesis, 'genesis'),
    finalized: {
      number: header.number,
      hash: requireHex(header.hash, 'finalized.hash'),
      parentHash: requireHex(header.parentHash, 'finalized.parentHash'),
      stateRoot: requireHex(header.stateRoot, 'finalized.stateRoot'),
    },
    titleId: requireHex(value.titleId, 'titleId'),
    storageKey: requireHex(value.storageKey, 'storageKey'),
    value: requireHex(value.value, 'value'),
    valueBytes: typeof value.valueBytes === 'number' ? value.valueBytes : 0,
    proofNodes: requireHexList(value.proofNodes, 'proofNodes'),
    canonicalStorageKey: requireHex(value.canonicalStorageKey, 'canonicalStorageKey'),
    canonicalValue: requireHex(value.canonicalValue, 'canonicalValue'),
    canonicalValueBytes:
      typeof value.canonicalValueBytes === 'number' ? value.canonicalValueBytes : 0,
    canonicalProofNodes: requireHexList(value.canonicalProofNodes, 'canonicalProofNodes'),
    record: {
      titleId: requireHex(fields.titleId, 'record.titleId'),
      chainId: requireString(fields.chainId, 'record.chainId'),
      nativeAsset: requireHex(fields.nativeAsset, 'record.nativeAsset'),
      backing: requireHex(fields.backing, 'record.backing'),
      owner: requireString(fields.owner, 'record.owner'),
      identityHash: requireHex(fields.identityHash, 'record.identityHash'),
      vestingHash: requireString(fields.vestingHash, 'record.vestingHash'),
      permissionsHash: requireString(fields.permissionsHash, 'record.permissionsHash'),
      evmContract: requireHex(fields.evmContract, 'record.evmContract'),
      revision: requireString(fields.revision, 'record.revision'),
    },
    representationLive:
      typeof value.representationLive === 'boolean' ? value.representationLive : false,
    capturedAt: requireString(value.capturedAt, 'capturedAt'),
  }
}

/**
 * Runs the committed proof through the same verifier the live console uses and
 * compares the reading to the record the fixture declares. Never throws on a
 * bad proof: a failed verification is a result with a status, because the page
 * has to show what failed.
 */
export function verifyLocalCapture(fixture: LocalCaptureFixture): LocalCaptureReport {
  const proof = verifyProof(
    fixture.canonicalStorageKey,
    fixture.canonicalProofNodes,
    fixture.finalized.stateRoot,
  )

  const valueBytes = (fixture.canonicalValue.length - 2) / 2
  const record = decodeCanonicalRecord(fixture.canonicalValue)

  const checks: CaptureCheck[] = []

  checks.push({
    label: 'the proof reaches a value under the finalized state root',
    detail: proof.message,
    tone: proof.ok ? 'ok' : proof.status === 'absent' ? 'warn' : 'bad',
  })

  const root = fixture.finalized.stateRoot
  const shortRoot = root.length > 24 ? `${root.slice(0, 12)}…${root.slice(-8)}` : root

  checks.push({
    label: 'a returned node rehashes to the root in the header',
    detail: proof.rootMatches
      ? `one of the ${proof.totalNodes} nodes hashes to ${shortRoot}, so the walk starts where the block does`
      : proof.status === 'root-mismatch'
        ? `no node hashes to ${shortRoot}`
        : 'the walk never reached the root',
    tone: proof.rootMatches ? 'ok' : 'bad',
  })

  checks.push({
    label: `the proven value is ${CANONICAL_RECORD_BYTES} bytes`,
    detail:
      proof.valueBytes === CANONICAL_RECORD_BYTES
        ? `${proof.valueBytes} bytes, ten 32 byte words`
        : `${proof.valueBytes} bytes measured`,
    tone: proof.valueBytes === CANONICAL_RECORD_BYTES ? 'ok' : 'bad',
  })

  checks.push({
    label: 'the proven bytes equal the canonical value in the fixture',
    detail:
      proof.valueHex !== null && proof.valueHex.toLowerCase() === fixture.canonicalValue.toLowerCase()
        ? 'byte for byte, no padding applied'
        : 'the walk returned different bytes',
    tone:
      proof.valueHex !== null && proof.valueHex.toLowerCase() === fixture.canonicalValue.toLowerCase()
        ? 'ok'
        : 'bad',
  })

  checks.push({
    label: 'word 0 is the title id',
    detail:
      record.titleId.toLowerCase() === fixture.record.titleId.toLowerCase()
        ? record.titleId
        : `${record.titleId} does not match the declared ${fixture.record.titleId}`,
    tone: record.titleId.toLowerCase() === fixture.record.titleId.toLowerCase() ? 'ok' : 'bad',
  })

  const declaredChainId = parseNumber(fixture.record.chainId)
  checks.push({
    label: 'word 1 is the chain id',
    detail:
      declaredChainId === null
        ? `the fixture prints ${fixture.record.chainId}, which has no digits`
        : declaredChainId === record.chainId
          ? `${record.chainIdLabel}, big endian`
          : `${record.chainIdLabel} does not match ${fixture.record.chainId}`,
    tone: declaredChainId === record.chainId ? 'ok' : 'bad',
  })

  checks.push({
    label: 'word 3 is the backing reference',
    detail:
      record.backing.toLowerCase() === fixture.record.backing.toLowerCase()
        ? 'the same 32 bytes the record declares'
        : 'the word differs from the declared backing',
    tone: record.backing.toLowerCase() === fixture.record.backing.toLowerCase() ? 'ok' : 'bad',
  })

  checks.push({
    label: 'word 9 is the revision',
    detail: `${record.revision.toString()}, big endian`,
    tone: record.revision === parseNumber(fixture.record.revision) ? 'ok' : 'bad',
  })

  // The owner word is the one field whose width is smaller than an AccountId.
  try {
    const account = toHex(decodeAddress(fixture.record.owner))
    const tail = account.slice(-40)
    const matches = record.ownerLow20.slice(2).toLowerCase() === tail.toLowerCase()
    const padded = record.ownerWord.startsWith('0x' + '00'.repeat(12))

    checks.push({
      label: 'word 4 carries the owner account',
      detail: matches
        ? padded
          ? `the low 20 bytes of ${fixture.record.owner}; the high 12 bytes of the word are zero`
          : 'the low 20 bytes match the declared account'
        : `the low 20 bytes do not match ${fixture.record.owner}`,
      tone: matches ? (padded ? 'warn' : 'ok') : 'bad',
    })
  } catch {
    checks.push({
      label: 'word 4 carries the owner account',
      detail: 'the fixture owner is not a decodable SS58 address',
      tone: 'warn',
    })
  }

  if (fixture.canonicalValueBytes !== valueBytes) {
    checks.push({
      label: "the fixture's declared byte count matches its own hex",
      detail: `it declares ${fixture.canonicalValueBytes} bytes; the hex measures ${valueBytes}`,
      tone: 'warn',
    })
  }

  return {
    fixture,
    proof,
    record,
    checks,
    valueBytes,
    declaredValueBytes: fixture.canonicalValueBytes,
    ok: proof.ok && checks.every((check) => check.tone !== 'bad'),
  }
}

/**
 * The committed capture, read straight from fixtures/ so the page can never
 * show a stale copy of it. Sends nothing anywhere.
 */
export function loadLocalCapture(): LocalCaptureReport {
  return verifyLocalCapture(parseFixture(fixtureJson))
}
