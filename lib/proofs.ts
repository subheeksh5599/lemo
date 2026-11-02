/**
 * Substrate state trie proofs, decoded and verified in the browser.
 *
 * A node returns the raw node byte strings for one key at a finalized block.
 * This module decodes them with the layout sp-trie actually writes (the
 * parity-scale-codec NodeHeader), walks the path from the state root, and
 * reports whether the proven value is bound to the root the chain declares.
 *
 *   header byte  0x00          empty
 *                0x40 - 0x7f   leaf, low 6 bits are the partial nibble count
 *                0x80 - 0xbf   branch without value, low 6 bits
 *                0xc0 - 0xff   branch with value, low 6 bits
 *                0x20 - 0x3f   leaf whose value is its own node, low 5 bits
 *                0x10 - 0x1f   branch whose value is its own node, low 4 bits
 *   the field is the count itself, not count - 1. The all-ones value for the
 *   field's width means continuation bytes follow.
 *   partial key   ceil(count / 2) bytes, padding nibble in the HIGH nibble.
 *   leaf          SCALE compact length + value bytes
 *   branch        2-byte little-endian bitmap, then the value when the header
 *                 says so, then one SCALE compact child reference per set bit
 *                 in ascending nibble order. A 32-byte reference is a hash, any
 *                 other length is an inline node.
 *
 * Hashing is blake2b-256. Every node is re-hashed here, so the order the node
 * returned the proof in does not matter.
 */

import { blake2AsU8a, xxhashAsU8a } from '@polkadot/util-crypto'

export type NodeKind =
  | 'leaf'
  | 'branch'
  | 'branch-with-value'
  | 'hashed-leaf'
  | 'hashed-branch'
  | 'empty'

export type ChildRef =
  | { kind: 'hash'; hash: Uint8Array }
  | { kind: 'inline'; node: Uint8Array }

export type DecodedNode = {
  kind: NodeKind
  partial: number[]
  value: Uint8Array | null
  valueHash: Uint8Array | null
  children: Map<number, ChildRef>
}

export class ProofError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProofError'
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = '0x'
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

export function fromHex(value: string): Uint8Array {
  const body = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value

  if (body.length === 0) return new Uint8Array()
  if (body.length % 2 !== 0) throw new ProofError('hex input has an odd number of digits')
  if (!/^[0-9a-fA-F]*$/.test(body)) throw new ProofError('hex input has a character outside 0-9a-f')

  const bytes = new Uint8Array(body.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function hashNode(bytes: Uint8Array): Uint8Array {
  return blake2AsU8a(bytes, 256)
}

export function shortHex(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 2) return value
  return `${value.slice(0, head)}..${value.slice(-tail)}`
}

/** twox128 of a string, the prefix every pallet storage key starts with. */
export function twox128(value: string): Uint8Array {
  return xxhashAsU8a(new TextEncoder().encode(value), 128)
}

/** The plain storage key for a pallet item, with no map segment. */
export function storageKey(pallet: string, item: string): string {
  return `${toHex(twox128(pallet))}${toHex(twox128(item)).slice(2)}`
}

function readCompact(bytes: Uint8Array, offset: number): { value: number; next: number } {
  const first = bytes[offset]
  if (first === undefined) throw new ProofError('truncated compact length')

  const mode = first & 0b11

  if (mode === 0b00) return { value: first >> 2, next: offset + 1 }

  if (mode === 0b01) {
    const second = bytes[offset + 1]
    if (second === undefined) throw new ProofError('truncated two byte compact length')
    return { value: ((first | (second << 8)) >>> 2) & 0x3fff, next: offset + 2 }
  }

  if (mode === 0b10) {
    if (offset + 4 > bytes.length) throw new ProofError('truncated four byte compact length')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
    return { value: view.getUint32(0, true) >>> 2, next: offset + 4 }
  }

  throw new ProofError('compact lengths above four bytes are not valid node lengths')
}

function readSized(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const { value: length, next } = readCompact(bytes, offset)
  if (next + length > bytes.length) throw new ProofError('a length runs past the end of its node')
  return { value: bytes.subarray(next, next + length), next: next + length }
}

type KindInfo = { kind: NodeKind; width: number; hashedValue: boolean }

function classify(header: number): KindInfo {
  if (header === 0x00) return { kind: 'empty', width: 6, hashedValue: false }

  const top = header & 0b1100_0000
  if (top === 0b0100_0000) return { kind: 'leaf', width: 6, hashedValue: false }
  if (top === 0b1000_0000) return { kind: 'branch', width: 6, hashedValue: false }
  if (top === 0b1100_0000) return { kind: 'branch-with-value', width: 6, hashedValue: false }
  if ((header & 0b1110_0000) === 0b0010_0000) return { kind: 'hashed-leaf', width: 5, hashedValue: true }
  if ((header & 0b1111_0000) === 0b0001_0000) return { kind: 'hashed-branch', width: 4, hashedValue: true }

  throw new ProofError(`unknown node header 0x${header.toString(16).padStart(2, '0')}`)
}

/** Reads the partial nibble count, including the continuation byte form. */
function readNibbleCount(header: number, width: number, bytes: Uint8Array) {
  const max = 0xff >> (8 - width)
  let remainder = header & max

  if (remainder < max) return { count: remainder, next: 1 }

  remainder -= 1
  let next = 1
  let byte = 0

  do {
    byte = bytes[next] ?? -1
    if (byte < 0) throw new ProofError('truncated partial key length')
    next += 1
    if (byte === 0xff) remainder += 255
  } while (byte === 0xff)

  return { count: remainder + byte + 1, next }
}

export function decodeNode(bytes: Uint8Array): DecodedNode {
  const header = bytes[0]
  if (header === undefined) throw new ProofError('empty node')

  const info = classify(header)

  if (info.kind === 'empty') {
    if (bytes.length !== 1) throw new ProofError('empty node carries trailing bytes')
    return { kind: 'empty', partial: [], value: null, valueHash: null, children: new Map() }
  }

  const { count, next: afterCount } = readNibbleCount(header, info.width, bytes)
  const byteCount = Math.ceil(count / 2)

  if (afterCount + byteCount > bytes.length) {
    throw new ProofError('partial key runs past the end of the node')
  }

  const partial: number[] = []

  for (let index = 0; index < byteCount; index += 1) {
    const byte = bytes[afterCount + index] ?? 0
    const high = byte >> 4
    const low = byte & 0x0f

    if (index === 0 && count % 2 === 1) {
      if (high !== 0) throw new ProofError('partial key padding nibble is not zero')
      partial.push(low)
    } else {
      partial.push(high, low)
    }
  }

  let offset = afterCount + byteCount

  if (info.kind === 'leaf' || info.kind === 'hashed-leaf') {
    if (info.hashedValue) {
      if (offset + 32 !== bytes.length) {
        throw new ProofError('hashed leaf is not exactly one 32 byte value reference')
      }
      return {
        kind: info.kind,
        partial,
        value: null,
        valueHash: bytes.subarray(offset, offset + 32),
        children: new Map(),
      }
    }

    const { value, next } = readSized(bytes, offset)
    if (next !== bytes.length) throw new ProofError('leaf node has trailing bytes')
    return { kind: info.kind, partial, value, valueHash: null, children: new Map() }
  }

  if (offset + 2 > bytes.length) throw new ProofError('branch node is missing its child bitmap')

  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2)
  const bitmap = view.getUint16(0, true)
  offset += 2

  let value: Uint8Array | null = null
  let valueHash: Uint8Array | null = null

  if (info.kind === 'branch-with-value' || info.kind === 'hashed-branch') {
    if (info.hashedValue) {
      if (offset + 32 > bytes.length) throw new ProofError('branch value reference runs past the node')
      valueHash = bytes.subarray(offset, offset + 32)
      offset += 32
    } else {
      const read = readSized(bytes, offset)
      if (read.value.length === 0) throw new ProofError('branch with value carries an empty value')
      value = read.value
      offset = read.next
    }
  }

  const children = new Map<number, ChildRef>()

  for (let nibble = 0; nibble < 16; nibble += 1) {
    if ((bitmap & (1 << nibble)) === 0) continue

    const read = readSized(bytes, offset)
    offset = read.next

    children.set(
      nibble,
      read.value.length === 32
        ? { kind: 'hash', hash: read.value }
        : { kind: 'inline', node: read.value },
    )
  }

  if (offset !== bytes.length) throw new ProofError('branch node has trailing bytes')

  return { kind: info.kind, partial, value, valueHash, children }
}

export type ProofStep = {
  index: number
  kind: NodeKind
  hash: string
  bytes: number
  nibbles: string
  /** nibble depth at which this node starts matching the key */
  depth: number
  children: number
  via: 'root' | 'hash' | 'inline'
  matched: number
}

export type ProofStatus = 'valid' | 'absent' | 'incomplete' | 'root-mismatch' | 'invalid'

export type ProofVerification = {
  status: ProofStatus
  ok: boolean
  stateRoot: string
  computedRoot: string | null
  rootMatches: boolean
  valueHex: string | null
  valueBytes: number
  valueHashed: boolean
  steps: ProofStep[]
  missing: string[]
  unusedNodes: number
  totalNodes: number
  totalBytes: number
  keyBytes: number
  message: string
}

const KIND_LABEL: Record<NodeKind, string> = {
  leaf: 'leaf',
  branch: 'branch',
  'branch-with-value': 'branch, value inline',
  'hashed-leaf': 'leaf, value hashed',
  'hashed-branch': 'branch, value hashed',
  empty: 'empty',
}

export function nodeKindLabel(kind: NodeKind): string {
  return KIND_LABEL[kind]
}

/** One hex character per nibble, so a branch prefix stays readable. */
export function hexNibbles(nibbles: readonly number[]): string {
  return nibbles.map((nibble) => nibble.toString(16)).join('')
}

/**
 * Decode the proof set, walk the path for one key, and check it against the
 * state root the chain reported. Never throws: a malformed node is a status,
 * because the page has to render what went wrong.
 */
export function verifyProof(
  key: string,
  proofNodes: readonly string[],
  stateRoot: string,
): ProofVerification {
  let totalBytes = 0
  for (const raw of proofNodes) totalBytes += Math.max(0, (raw.length - 2) / 2)

  const base = {
    stateRoot,
    computedRoot: null as string | null,
    rootMatches: false,
    valueHex: null as string | null,
    valueBytes: 0,
    valueHashed: false,
    steps: [] as ProofStep[],
    missing: [] as string[],
    unusedNodes: 0,
    totalNodes: proofNodes.length,
    totalBytes,
    keyBytes: 0,
  }

  const stop = (
    status: ProofStatus,
    message: string,
    extra: Partial<ProofVerification> = {},
  ): ProofVerification => ({
    status,
    ok: false,
    ...base,
    message,
    ...extra,
  })

  let keyBytes: Uint8Array

  try {
    keyBytes = fromHex(key)
  } catch (cause) {
    return stop('invalid', cause instanceof Error ? cause.message : 'the key is not hex')
  }

  if (keyBytes.length === 0) return stop('invalid', 'the storage key is empty')

  const path: number[] = []
  for (const byte of keyBytes) path.push(byte >> 4, byte & 0x0f)

  if (proofNodes.length === 0) {
    return stop('incomplete', 'the node returned no proof nodes', { keyBytes: keyBytes.length })
  }

  const index = new Map<string, { bytes: Uint8Array; hash: string }>()

  for (const raw of proofNodes) {
    let bytes: Uint8Array
    try {
      bytes = fromHex(raw)
    } catch (cause) {
      return stop(
        'invalid',
        `a proof node is not hex: ${cause instanceof Error ? cause.message : 'unknown'}`,
        { keyBytes: keyBytes.length },
      )
    }

    const hash = toHex(hashNode(bytes))
    index.set(hash, { bytes, hash })
  }

  const wanted = stateRoot.toLowerCase()
  const root = index.get(wanted)

  if (root === undefined) {
    return stop('root-mismatch', 'no node in this proof hashes to the state root the chain reported', {
      keyBytes: keyBytes.length,
    })
  }

  const steps: ProofStep[] = []
  const missing: string[] = []
  const used = new Set<string>([wanted])

  let node = root
  let decoded: DecodedNode

  try {
    decoded = decodeNode(node.bytes)
  } catch (cause) {
    return stop(
      'invalid',
      `the root node does not decode: ${cause instanceof Error ? cause.message : 'unknown'}`,
      { computedRoot: node.hash, rootMatches: true, keyBytes: keyBytes.length },
    )
  }

  let offset = 0
  let via: ProofStep['via'] = 'root'

  for (;;) {
    const compare = path.slice(offset, offset + decoded.partial.length)
    const matched =
      compare.length === decoded.partial.length &&
      compare.every((nibble, position) => nibble === decoded.partial[position])

    steps.push({
      index: steps.length,
      kind: decoded.kind,
      hash: node.hash,
      bytes: node.bytes.length,
      nibbles: hexNibbles(decoded.partial),
      depth: offset,
      children: decoded.children.size,
      via,
      matched: matched ? decoded.partial.length : 0,
    })

    const resolved = (valueHex: string, valueHashed: boolean): ProofVerification => ({
      status: 'valid',
      ok: true,
      ...base,
      computedRoot: node.hash,
      rootMatches: true,
      valueHex,
      valueBytes: (valueHex.length - 2) / 2,
      valueHashed,
      steps,
      missing,
      unusedNodes: index.size - used.size,
      totalNodes: index.size,
      keyBytes: keyBytes.length,
      message: valueHashed
        ? 'the value node is bound to the same state root'
        : 'the value sits in the node the state root reaches',
    })

    const hashedValue = (hash: Uint8Array) => {
      const childHash = toHex(hash)
      const valueNode = index.get(childHash)

      if (valueNode === undefined) {
        missing.push(childHash)
        return stop('incomplete', 'the value node is not in this proof', {
          computedRoot: node.hash,
          rootMatches: true,
          steps: [...steps],
          missing: [...missing],
          valueHashed: true,
          totalNodes: index.size,
          keyBytes: keyBytes.length,
        })
      }

      used.add(childHash)
      return resolved(toHex(valueNode.bytes), true)
    }

    if (!matched) {
      return stop('absent', 'the walk leaves the key path before it reaches a value', {
        computedRoot: node.hash,
        rootMatches: true,
        steps: [...steps],
        totalNodes: index.size,
        keyBytes: keyBytes.length,
      })
    }

    offset += decoded.partial.length

    if (decoded.kind === 'empty') {
      return stop('absent', 'the trie is empty at this root', {
        computedRoot: node.hash,
        rootMatches: true,
        steps: [...steps],
        totalNodes: index.size,
        keyBytes: keyBytes.length,
      })
    }

    if (decoded.kind === 'leaf' || decoded.kind === 'hashed-leaf') {
      if (offset !== path.length) {
        return stop('absent', 'the leaf ends before the key does', {
          computedRoot: node.hash,
          rootMatches: true,
          steps: [...steps],
          totalNodes: index.size,
          keyBytes: keyBytes.length,
        })
      }

      if (decoded.valueHash !== null) return hashedValue(decoded.valueHash)
      return resolved(toHex(decoded.value ?? new Uint8Array()), false)
    }

    // Branch: a value here only counts when the key ends exactly at this node.
    if (offset === path.length) {
      if (decoded.valueHash !== null) return hashedValue(decoded.valueHash)

      if (decoded.value === null) {
        return stop('absent', 'the branch on this path carries no value', {
          computedRoot: node.hash,
          rootMatches: true,
          steps: [...steps],
          totalNodes: index.size,
          keyBytes: keyBytes.length,
        })
      }

      return resolved(toHex(decoded.value), false)
    }

    const nextNibble = path[offset]

    if (nextNibble === undefined) {
      return stop('absent', 'the key ends before the branch descends', {
        computedRoot: node.hash,
        rootMatches: true,
        steps: [...steps],
        totalNodes: index.size,
        keyBytes: keyBytes.length,
      })
    }

    const child = decoded.children.get(nextNibble)

    offset += 1

    if (child === undefined) {
      return stop('absent', `the branch has no child under nibble ${nextNibble}`, {
        computedRoot: node.hash,
        rootMatches: true,
        steps: [...steps],
        totalNodes: index.size,
        keyBytes: keyBytes.length,
      })
    }

    if (child.kind === 'inline') {
      try {
        decoded = decodeNode(child.node)
      } catch (cause) {
        return stop(
          'invalid',
          `an inline node does not decode: ${cause instanceof Error ? cause.message : 'unknown'}`,
          {
            computedRoot: node.hash,
            rootMatches: true,
            steps: [...steps],
            totalNodes: index.size,
            keyBytes: keyBytes.length,
          },
        )
      }
      node = { bytes: child.node, hash: toHex(hashNode(child.node)) }
      via = 'inline'
      continue
    }

    const childHash = toHex(child.hash)
    const referenced = index.get(childHash)

    if (referenced === undefined) {
      missing.push(childHash)

      const unused = index.size - used.size

      if (unused > 0) {
        return stop('invalid', 'a returned node does not hash to the reference its parent carries', {
          computedRoot: node.hash,
          rootMatches: true,
          steps: [...steps],
          missing: [...missing],
          unusedNodes: unused,
          totalNodes: index.size,
          keyBytes: keyBytes.length,
        })
      }

      return stop('incomplete', 'the proof does not carry every node on the path', {
        computedRoot: node.hash,
        rootMatches: true,
        steps: [...steps],
        missing: [...missing],
        totalNodes: index.size,
        keyBytes: keyBytes.length,
      })
    }

    used.add(childHash)
    node = referenced
    via = 'hash'

    try {
      decoded = decodeNode(node.bytes)
    } catch (cause) {
      return stop(
        'invalid',
        `node ${childHash.slice(0, 10)} does not decode: ${cause instanceof Error ? cause.message : 'unknown'}`,
        {
          computedRoot: node.hash,
          rootMatches: true,
          steps: [...steps],
          totalNodes: index.size,
          keyBytes: keyBytes.length,
        },
      )
    }
  }
}

export type DecodedValue = {
  /** short name of the width that produced the reading */
  reading: string
  /** the human value */
  value: string
  note: string
}

/**
 * Reads a storage value with the width its byte length implies. The raw hex is
 * always shown next to this reading, because a width inferred from a length is
 * a reading, not a decode of a declared type.
 */
export function decodeStorageValue(hex: string | null): DecodedValue | null {
  if (hex === null) return null

  let bytes: Uint8Array
  try {
    bytes = fromHex(hex)
  } catch {
    return { reading: 'hex', value: hex, note: 'not valid hex' }
  }

  if (bytes.length === 0) return { reading: 'empty', value: '0 bytes', note: 'the value is empty' }

  const littleEndian = (length: number) => {
    let total = 0n
    for (let index = length - 1; index >= 0; index -= 1) {
      total = (total << 8n) | BigInt(bytes[index] ?? 0)
    }
    return total
  }

  if (bytes.length === 4) {
    return {
      reading: 'u32',
      value: littleEndian(4).toString(),
      note: 'read as a 32 bit little endian integer',
    }
  }

  if (bytes.length === 8) {
    return {
      reading: 'u64',
      value: littleEndian(8).toString(),
      note: 'read as a 64 bit little endian integer',
    }
  }

  if (bytes.length === 16) {
    return {
      reading: 'u128',
      value: littleEndian(16).toString(),
      note: 'read as a 128 bit little endian integer',
    }
  }

  const printable = bytes.every((byte) => byte >= 0x20 && byte <= 0x7e)

  if (printable && bytes.length <= 64) {
    return {
      reading: 'text',
      value: new TextDecoder().decode(bytes),
      note: 'every byte is printable ASCII',
    }
  }

  return {
    reading: 'bytes',
    value: `${bytes.length} bytes`,
    note: 'no integer width matches this length',
  }
}
