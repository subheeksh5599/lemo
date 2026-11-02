/**
 * What the page asks a visitor for, and the one thing it must not do: turn an
 * unreadable proof into a transaction that the gate will reject anyway.
 *
 * The proof's own fields are supplied by the visitor, because only a node can
 * produce them: the state root of a finalized block, the key the title record
 * lives under, and the sp-trie nodes between them. The fields that bind that
 * proof to *this* token — title id, chain id, gate address, operation — are read
 * from the contract at call time, never typed in.
 */

import type { CallArgument } from './codec'

export type ParsedProof = {
  stateRoot: string
  revision: bigint
  storageKey: string
  nodes: string[]
}

export type ProofParse =
  | { ok: true; proof: ParsedProof }
  | { ok: false; problem: string }

const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/

function asHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.toLowerCase()
}

function asRevision(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim())
  return null
}

/**
 * Reads the shape a node already returns for `state_getReadProof`
 * (`{ at, proof }`) as well as the flat shape this page documents, so a visitor
 * can paste the RPC result unchanged.
 */
export function parseProof(raw: string): ProofParse {
  const text = raw.trim()
  if (text.length === 0) return { ok: false, problem: 'Paste a proof to continue.' }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, problem: 'That is not JSON. Paste the object the node returned.' }
  }

  if (typeof value !== 'object' || value === null) {
    return { ok: false, problem: 'A proof has to be an object.' }
  }

  const record = value as Record<string, unknown>

  const stateRoot = asHex(record.stateRoot)
  if (stateRoot === null || !BYTES32.test(stateRoot)) {
    return { ok: false, problem: 'stateRoot must be a 32 byte 0x hex string.' }
  }

  const storageKey = asHex(record.storageKey ?? record.key)
  if (storageKey === null || !HEX.test(storageKey)) {
    return { ok: false, problem: 'storageKey must be a 0x hex string of whole bytes.' }
  }

  const revision = asRevision(record.revision)
  if (revision === null || revision === 0n) {
    return { ok: false, problem: 'revision must be a positive integer (the first commit is 1).' }
  }

  const rawNodes = record.nodes ?? record.proof
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return { ok: false, problem: 'nodes must be a non-empty array of 0x hex strings.' }
  }

  const nodes: string[] = []
  for (const [index, node] of rawNodes.entries()) {
    const hex = asHex(node)
    if (hex === null || !HEX.test(hex)) {
      return { ok: false, problem: `node ${index + 1} is not a 0x hex string of whole bytes.` }
    }
    nodes.push(hex)
  }

  return { ok: true, proof: { stateRoot, storageKey, revision, nodes } }
}

export type ProofBinding = {
  titleId: string
  chainId: bigint
  token: string
  operation: number
}

/**
 * The tuple `ITitleVerifier.TitleProof` in the order the ABI declares it. The
 * binding fields come from live contract reads, so a proof cannot be aimed at a
 * different token than the one it was pasted into.
 */
export function titleProofTuple(proof: ParsedProof, binding: ProofBinding): readonly CallArgument[] {
  return [
    binding.titleId,
    binding.chainId,
    proof.revision,
    binding.token,
    binding.operation,
    proof.stateRoot,
    proof.storageKey,
    proof.nodes,
  ]
}

/** The verifier's `Status` enum, in the order ITitleVerifier declares it. */
export const VERIFIER_STATUS = [
  'NONE',
  'PROVEN',
  'ABSENT',
  'INCOMPLETE',
  'INVALID',
  'ROOT_MISMATCH',
  'VALUE_MISMATCH',
] as const

export function statusWord(status: bigint | number): string {
  const index = Number(status)
  return VERIFIER_STATUS[index] ?? `status ${index}`
}
