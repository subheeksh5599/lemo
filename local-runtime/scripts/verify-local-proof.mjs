/**
 * Verify a local LEMO capture against its finalized state root.
 *
 * Uses the same TypeScript verifier the app uses (lemo/lib/proofs.ts) so the
 * local check exercises the exact code path that renders proofs in the UI.
 * Node >= 22.6 strips the types on import; no build step or tsx is needed.
 *
 * Usage:
 *   node scripts/verify-local-proof.mjs <capture.json> <result.json>
 *
 * Exits 0 only when both the raw and the canonical title values are proven
 * present under the root the chain reported and the proven bytes equal the
 * bytes the capture recorded.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { verifyProof } from '../../lib/proofs.ts'

const capturePath = process.argv[2]
const resultPath = process.argv[3]

if (!capturePath || !resultPath) {
  console.error('usage: node scripts/verify-local-proof.mjs <capture.json> <result.json>')
  process.exit(2)
}

const capture = JSON.parse(readFileSync(capturePath, 'utf8'))
const stateRoot = capture?.finalized?.stateRoot

if (typeof stateRoot !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(stateRoot)) {
  console.error('capture has no valid finalized.stateRoot')
  process.exit(2)
}

const hexBytes = (value) =>
  typeof value === 'string' && value.startsWith('0x') ? (value.length - 2) / 2 : 0

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail }
}

function verify(label, storageKey, valueHex, proofNodes) {
  const proof = verifyProof(storageKey, proofNodes, stateRoot)
  const provenValue = proof.valueHex
  const valueMatches =
    typeof provenValue === 'string' &&
    typeof valueHex === 'string' &&
    provenValue.toLowerCase() === valueHex.toLowerCase()

  return {
    label,
    storageKey,
    keyBytes: hexBytes(storageKey),
    valueBytes: hexBytes(valueHex),
    proofNodeCount: proofNodes.length,
    proofBytes: proof.totalBytes,
    status: proof.status,
    ok: proof.ok,
    rootMatches: proof.rootMatches,
    computedRoot: proof.computedRoot,
    stateRoot,
    valueHex,
    provenValueHex: provenValue,
    valueMatches,
    steps: proof.steps.map((step) => ({
      index: step.index,
      kind: step.kind,
      depth: step.depth,
      bytes: step.bytes,
      via: step.via,
      children: step.children,
      matched: step.matched,
    })),
    missing: proof.missing,
    message: proof.message,
  }
}

const raw = verify(
  'raw-title',
  capture.storageKey,
  capture.value,
  capture.proofNodes ?? [],
)
const canonical = verify(
  'canonical-title',
  capture.canonicalStorageKey,
  capture.canonicalValue,
  capture.canonicalProofNodes ?? [],
)

const checks = [
  check(
    'capture-is-local',
    capture.source === 'local-lemo-runtime',
    `source=${capture.source ?? 'missing'}`,
  ),
  check(
    'finalized-header-present',
    Number.isInteger(capture.finalized?.number) && capture.finalized.number > 0,
    `block=${capture.finalized?.number ?? 'missing'} hash=${capture.finalized?.hash ?? 'missing'}`,
  ),
  check(
    'raw-proof-valid',
    raw.status === 'valid' && raw.ok && raw.rootMatches,
    `status=${raw.status} rootMatches=${raw.rootMatches}`,
  ),
  check(
    'raw-value-matches',
    raw.valueMatches,
    `${raw.valueBytes} bytes proven vs ${hexBytes(capture.value)} captured`,
  ),
  check(
    'raw-value-length-280',
    raw.valueBytes === 280,
    `valueBytes=${raw.valueBytes}`,
  ),
  check(
    'canonical-proof-valid',
    canonical.status === 'valid' && canonical.ok && canonical.rootMatches,
    `status=${canonical.status} rootMatches=${canonical.rootMatches}`,
  ),
  check(
    'canonical-value-matches',
    canonical.valueMatches,
    `${canonical.valueBytes} bytes proven vs ${hexBytes(capture.canonicalValue)} captured`,
  ),
  check(
    'canonical-value-length-320',
    canonical.valueBytes === 320,
    `valueBytes=${canonical.valueBytes}`,
  ),
  check(
    'both-proofs-share-root',
    raw.stateRoot === canonical.stateRoot && raw.stateRoot === stateRoot,
    `stateRoot=${stateRoot}`,
  ),
]

const result = {
  ok: checks.every((entry) => entry.ok),
  generator: 'lemo-runtime/scripts/verify-local-proof.mjs',
  capture: capturePath,
  verifiedAt: new Date().toISOString(),
  endpoint: capture.endpoint,
  chain: capture.chain,
  runtime: {
    specName: capture.runtime?.specName,
    specVersion: capture.runtime?.specVersion,
    stateVersion: capture.runtime?.stateVersion,
  },
  block: {
    number: capture.finalized?.number,
    hash: capture.finalized?.hash,
    parentHash: capture.finalized?.parentHash,
    stateRoot,
    capturedAt: capture.capturedAt,
  },
  titleId: capture.titleId,
  raw,
  canonical,
  checks,
}

writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)

console.log(
  `raw:       ${raw.status} root=${raw.rootMatches} value=${raw.valueBytes}B nodes=${raw.proofNodeCount} steps=${raw.steps.length}`,
)
console.log(
  `canonical: ${canonical.status} root=${canonical.rootMatches} value=${canonical.valueBytes}B nodes=${canonical.proofNodeCount} steps=${canonical.steps.length}`,
)

if (!result.ok) {
  console.error('verification FAILED')
  for (const entry of checks.filter((item) => !item.ok)) {
    console.error(`  - ${entry.name}: ${entry.detail}`)
  }
  process.exit(1)
}

console.log(`verified against state root ${stateRoot} at block ${capture.finalized.number}`)
