/**
 * The recorded local lifecycle (fixtures/local-e2e.json), loaded and
 * re-verified in the browser.
 *
 * scripts/local-e2e.mjs drove real transactions on two local chains: a
 * solochain template node running pallet-lemo-title (native half, no Revive)
 * and anvil (EVM half). This module re-checks the three things a reader would
 * otherwise have to take on trust, from the committed bytes alone:
 *
 *   header      blake2_256(SCALE header) equals the justified block hash, and
 *               the state root is read out of those header bytes
 *   GRANDPA     every precommit in the justification is an ed25519 signature
 *               over SCALE(Precommit) ++ round ++ set_id by the dev authority
 *   storage     the trie walk for the CanonicalTitles key reaches the value
 *               (or proves it absent) from that state root
 */

import { blake2AsU8a, ed25519Verify } from '@polkadot/util-crypto'

import fixtureJson from '@/fixtures/local-e2e.json'
import { fromHex, toHex, verifyProof, type ProofVerification } from '@/lib/proofs'

export type NativeStep = {
  label: string
  signer: string
  extrinsicHash: string
  blockHash: string
  blockNumber: number
  extrinsicIndex: number
  outcome: 'success' | 'failed'
  error: { pallet: string | null; error: string; docs: string } | null
  events: { name: string; data: unknown }[]
}

export type EvmStep = {
  label: string
  from: string
  to: string | null
  txHash: string
  blockNumber: number
  blockHash: string
  status: 'success' | 'reverted'
  gasUsed: number
  contractAddress: string | null
  revert: { selector: string | null; error: string; args?: string[] } | null
}

export type Precommit = { targetHash: string; targetNumber: number; signature: string; id: string }

export type Capture = {
  label: string
  titleId: string
  chainId: string | null
  revision: string | null
  header: {
    number: number
    hash: string
    parentHash: string
    stateRoot: string
    extrinsicsRoot: string
    encoded: string
  }
  finalizedHeadAtCapture: { hash: string; number: number }
  justification: {
    encoded: string
    source: string
    round: string
    setId: string
    targetHash: string
    targetNumber: number
    precommits: Precommit[]
  }
  authorities: { id: string; weight: string }[]
  storageKey: string
  value: string | null
  valueBytes: number
  proofNodes: string[]
}

export type EvmSnapshot = {
  after: string
  totalSupply: string
  beneficiary: string
  bob: string
  representationOutstanding: boolean
  acceptedRevision: string
  feedRoot: string
  feedBlock: string
}

export type LocalE2E = {
  kind: string
  note: string
  capturedAt: string
  native: {
    endpoint: string
    chain: string
    genesis: string
    runtime: { specName: string; specVersion: string; stateVersion: string }
    devAuthority: { name: string; publicKey: string }
    accounts: { alice: string; bob: string }
    salt: string
    titleId: string
    titleIdDerivation: string
    fields: Record<string, string | number>
    deposit: { reservedBefore: string; reservedAfterCreate: string; reservedAfterFinalize: string }
    titleExistsAfterFinalize: boolean
    unbondDueBlock: number
    steps: NativeStep[]
  }
  proofs: { A: Capture; B: Capture; C: Capture }
  evm: {
    endpoint: string
    chainId: number
    accounts: { deployer: string; beneficiary: string; bob: string }
    contracts: { hasher: string; verifier: string; feed: string; gate: string; guard: string }
    predictedGate: string
    titleCommitment: string
    maxSupply: string
    transferAmount: string
    steps: EvmStep[]
    state: EvmSnapshot[]
    guard: { requestId: string; released: boolean; requestTx: string }
  }
}

export const run = fixtureJson as unknown as LocalE2E

// ------------------------------------------------------------------ header

export type HeaderCheck = {
  computedHash: string
  hashMatches: boolean
  numberFromBytes: number
  numberMatches: boolean
  stateRootFromBytes: string
  stateRootMatches: boolean
  ok: boolean
}

function compact(bytes: Uint8Array, at: number): [number, number] {
  const mode = bytes[at] & 3
  if (mode === 0) return [bytes[at] >> 2, 1]
  if (mode === 1) return [(bytes[at] | (bytes[at + 1] << 8)) >> 2, 2]
  if (mode === 2) {
    return [
      (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 2,
      4,
    ]
  }
  throw new Error('compact integer wider than 32 bits')
}

/** SCALE header: parent hash, compact number, state root, extrinsics root, digest. */
export function checkHeader(capture: Capture): HeaderCheck {
  const bytes = fromHex(capture.header.encoded)
  const computedHash = toHex(blake2AsU8a(bytes, 256))
  const [numberFromBytes, width] = compact(bytes, 32)
  const stateRootFromBytes = toHex(bytes.subarray(32 + width, 64 + width))
  const hashMatches = computedHash === capture.header.hash.toLowerCase()
  const numberMatches = numberFromBytes === capture.header.number
  const stateRootMatches = stateRootFromBytes === capture.header.stateRoot.toLowerCase()
  return {
    computedHash,
    hashMatches,
    numberFromBytes,
    numberMatches,
    stateRootFromBytes,
    stateRootMatches,
    ok: hashMatches && numberMatches && stateRootMatches,
  }
}

// ----------------------------------------------------------------- GRANDPA

export type PrecommitCheck = {
  id: string
  signature: string
  message: string
  signatureOk: boolean
  isDevAuthority: boolean
  targetsBlock: boolean
}

export type JustificationCheck = {
  /** the justification bytes decode to the round and target the fixture lists */
  decodesAsListed: boolean
  round: string
  setId: string
  commitTargetsBlock: boolean
  precommits: PrecommitCheck[]
  signed: number
  ok: boolean
}

/** SCALE(Message::Precommit) ++ round u64 LE ++ set_id u64 LE, what each voter signs. */
export function precommitMessage(
  targetHash: string,
  targetNumber: number,
  round: string,
  setId: string,
): Uint8Array {
  const m = new Uint8Array(1 + 32 + 4 + 8 + 8)
  const view = new DataView(m.buffer)
  m[0] = 1
  m.set(fromHex(targetHash), 1)
  view.setUint32(33, targetNumber, true)
  view.setBigUint64(37, BigInt(round), true)
  view.setBigUint64(45, BigInt(setId), true)
  return m
}

/** Decode the raw justification here rather than trusting the listed fields. */
function decodeJustification(hex: string) {
  const b = fromHex(hex)
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const round = view.getBigUint64(0, true).toString()
  const targetHash = toHex(b.subarray(8, 40))
  const targetNumber = view.getUint32(40, true)
  const [count, width] = compact(b, 44)
  let at = 44 + width
  const precommits: Precommit[] = []
  for (let i = 0; i < count; i += 1) {
    precommits.push({
      targetHash: toHex(b.subarray(at, at + 32)),
      targetNumber: view.getUint32(at + 32, true),
      signature: toHex(b.subarray(at + 36, at + 100)),
      id: toHex(b.subarray(at + 100, at + 132)),
    })
    at += 132
  }
  return { round, targetHash, targetNumber, precommits }
}

export function checkJustification(capture: Capture, devAuthority: string): JustificationCheck {
  const j = capture.justification
  const decoded = decodeJustification(j.encoded)
  const decodesAsListed =
    decoded.round === j.round &&
    decoded.targetHash === j.targetHash.toLowerCase() &&
    decoded.targetNumber === j.targetNumber &&
    decoded.precommits.length === j.precommits.length
  const commitTargetsBlock =
    decoded.targetHash === capture.header.hash.toLowerCase() &&
    decoded.targetNumber === capture.header.number

  const precommits = decoded.precommits.map((p) => {
    const message = precommitMessage(p.targetHash, p.targetNumber, decoded.round, j.setId)
    return {
      id: p.id,
      signature: p.signature,
      message: toHex(message),
      signatureOk: ed25519Verify(message, fromHex(p.signature), fromHex(p.id)),
      isDevAuthority: p.id === devAuthority.toLowerCase(),
      // A precommit for a descendant also finalizes the target; here they are equal.
      targetsBlock: p.targetNumber >= decoded.targetNumber,
    }
  })
  const signed = precommits.filter((p) => p.signatureOk && p.isDevAuthority).length
  // One authority of weight one: a single valid vote is the supermajority.
  const ok = decodesAsListed && commitTargetsBlock && signed === capture.authorities.length && signed > 0

  return { decodesAsListed, round: decoded.round, setId: j.setId, commitTargetsBlock, precommits, signed, ok }
}

// ----------------------------------------------------------------- storage

export type CaptureReport = {
  capture: Capture
  header: HeaderCheck
  grandpa: JustificationCheck
  proof: ProofVerification
  /** for A and B: the proven value equals the captured one; for C: absent */
  expected: 'present' | 'absent'
  storageOk: boolean
  ok: boolean
}

export function verifyCapture(capture: Capture, devAuthority: string): CaptureReport {
  const header = checkHeader(capture)
  const grandpa = checkJustification(capture, devAuthority)
  const proof = verifyProof(capture.storageKey, capture.proofNodes, header.stateRootFromBytes)
  const expected = capture.value === null ? 'absent' : 'present'
  const storageOk =
    expected === 'absent'
      ? proof.status === 'absent'
      : proof.status === 'valid' && proof.valueHex?.toLowerCase() === capture.value?.toLowerCase()
  return { capture, header, grandpa, proof, expected, storageOk, ok: header.ok && grandpa.ok && storageOk }
}

// ------------------------------------------------------------------ record

export type DecodedRecord = {
  titleId: string
  chainId: bigint
  nativeAsset: string
  backing: string
  evmBeneficiary: string
  identityHash: string
  vestingHash: string
  permissionsHash: string
  evmContract: string
  revision: bigint
}

export function decodeRecord(hex: string): DecodedRecord {
  const bytes = fromHex(hex)
  if (bytes.length !== 320) throw new Error(`the canonical value is ${bytes.length} bytes, not 320`)
  const word = (i: number) => bytes.subarray(i * 32, (i + 1) * 32)
  const big = (w: Uint8Array) => w.reduce((total, byte) => (total << 8n) | BigInt(byte), 0n)
  return {
    titleId: toHex(word(0)),
    chainId: big(word(1)),
    nativeAsset: toHex(word(2)),
    backing: toHex(word(3)),
    evmBeneficiary: toHex(word(4).subarray(12)),
    identityHash: toHex(word(5)),
    vestingHash: toHex(word(6)),
    permissionsHash: toHex(word(7)),
    evmContract: toHex(word(8).subarray(12)),
    revision: big(word(9)),
  }
}

// ---------------------------------------------------------------- lookups

export function nativeStep(label: string): NativeStep {
  const step = run.native.steps.find((s) => s.label === label)
  if (step === undefined) throw new Error(`the run has no native step "${label}"`)
  return step
}

export function evmStep(label: string): EvmStep {
  const step = run.evm.steps.find((s) => s.label === label)
  if (step === undefined) throw new Error(`the run has no EVM step "${label}"`)
  return step
}

export function evmState(after: string): EvmSnapshot {
  const state = run.evm.state.find((s) => s.after === after)
  if (state === undefined) throw new Error(`the run has no EVM snapshot after "${after}"`)
  return state
}

/** 18 decimals, whole tokens only (the run moves whole amounts). */
export function tokens(wei: string): string {
  const value = BigInt(wei) / 10n ** 18n
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
