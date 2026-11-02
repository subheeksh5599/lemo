import { blake2AsU8a } from "@polkadot/util-crypto";
import { bytesToHex, equalBytes, hexToBytes, isHex, toNibbles, type Hex } from "../util/bytes.ts";

/**
 * Storage-trie proof verification for Substrate (sp-trie `NodeCodec`).
 *
 * Every claim below is pinned by `test/fixtures/*.json`, which are real
 * `state_getReadProof` responses captured from the Portaldot V3 testnet. The
 * previous decoder in this file tested `header & 0x80` for "leaf", which reads
 * the state root (a branch, typically `0x80...`) as a leaf and throws on every
 * live proof.
 *
 *   header byte
 *     0x00                              empty node (root of an empty trie)
 *     0b01??????  (0x40-0x7f)           leaf, value inline
 *     0b10??????  (0x80-0xbf)           branch, no value at this point
 *     0b11??????  (0xc0-0xff)           branch holding a value at this point
 *     0b001?????  (0x20-0x3f)           leaf, value stored as its own node
 *     0b0001????  (0x10-0x1f)           branch, value stored as its own node
 *
 * The low bits are the partial-key length in NIBBLES, not length - 1. When they
 * are all ones (0x3f / 0x1f / 0x0f depending on the kind) a continuation byte
 * follows:
 *
 *     r = header & max
 *     if r === max: r -= 1; while ((b = next()) === 0xff) r += 255; count = r + b + 1
 *
 * A partial key with an odd nibble count is packed with a zero pad nibble at the
 * FRONT of the first byte, so `count` nibbles are read from the tail of
 * `ceil(count / 2)` bytes.
 *
 * leaf   : header, partial, then the value: SCALE compact length + bytes, or a
 *          raw 32-byte hash when the header kind says "value is a node".
 * branch : header, partial, 2-byte little-endian child bitmap, the value when
 *          the header says the branch carries one, then one reference per set
 *          bit in ascending nibble order. A reference is a SCALE compact length
 *          followed by that many bytes; exactly 32 bytes is a blake2_256
 *          reference resolved from the proof set, any other length is an
 *          inline child node.
 *
 * Values of 32 bytes and up are stored as their own proof node. That node is
 * the RAW value bytes with no length prefix: `blake2_256(rawValue)` is exactly
 * the hash the referencing leaf carries (verified against `system-account.json`,
 * where an 80-byte `AccountInfo` appears as an 80-byte node whose hash is the
 * leaf's reference).
 *
 * Two failure modes must never collapse into "absent":
 *   - a referenced node missing from the proof set (truncated response);
 *   - a value node missing while the leaf that references it is present.
 * Both are `incomplete`. `absent` means the walk PROVED no value exists: it hit
 * an empty node, a diverging partial key, a branch whose bitmap lacks the next
 * nibble, or a branch with no value at the key's end.
 */

export type NodeKind =
  | "empty"
  | "leaf"
  | "branch"
  | "branchWithValue"
  | "hashedLeaf"
  | "hashedBranchWithValue";

export type TrieErrorKind =
  | "INVALID_INPUT"
  | "EMPTY_PROOF"
  | "ROOT_MISSING"
  | "NODE_MISSING"
  | "VALUE_NODE_MISSING"
  | "NODE_HASH_MISMATCH"
  | "MALFORMED_NODE"
  | "DUPLICATE_NODE"
  | "PATH_DIVERGED"
  | "NO_CHILD"
  | "BRANCH_WITHOUT_VALUE"
  | "EMPTY_NODE"
  | "VALUE_MISMATCH";

export type ProofStatus =
  /** The walk reached a value; it matches the expected value if one was given. */
  | "present"
  /** The walk proved no value exists at this key. */
  | "absent"
  /** A value was proved, but it contradicts what the caller claimed. */
  | "mismatch"
  /** Not enough nodes to decide: the proof is truncated, not negative. */
  | "invalid"
  | "incomplete";

export type ValueRef =
  | { readonly kind: "inline"; readonly bytes: Uint8Array }
  | { readonly kind: "hashed"; readonly hash: Uint8Array };

export type ChildRef =
  | { readonly kind: "hash"; readonly hash: Uint8Array }
  | { readonly kind: "inline"; readonly node: Uint8Array };

export type DecodedNode =
  | { readonly kind: "empty"; readonly header: NodeKind; readonly partial: readonly number[] }
  | {
      readonly kind: "leaf";
      /** The header kind, so a hashed-value leaf stays distinguishable. */
      readonly header: NodeKind;
      readonly partial: readonly number[];
      readonly value: ValueRef;
    }
  | {
      readonly kind: "branch";
      readonly header: NodeKind;
      readonly partial: readonly number[];
      readonly value: ValueRef | null;
      readonly children: ReadonlyMap<number, ChildRef>;
    };

/** A decoding failure; `verifyStorageProof` folds these into an `invalid` result. */
export class TrieDecodeError extends Error {
  readonly kind: TrieErrorKind;

  constructor(kind: TrieErrorKind, message: string) {
    super(message);
    this.name = "TrieDecodeError";
    this.kind = kind;
  }
}

export type ProofStep = {
  readonly depth: number;
  /** blake2_256 of the node bytes: the reference that selected it. */
  readonly node: Hex;
  readonly kind: NodeKind;
  /** Nibbles of the key consumed by this node's partial key. */
  readonly partial: number;
  /** Key nibble position after this node's partial key was consumed. */
  readonly position: number;
  readonly bitmap: number | null;
  /** Child nibble taken from this node, when the walk descended through it. */
  readonly childNibble: number | null;
  /** Byte length of the value this node carries, before hashed-node resolution. */
  readonly valueLength: number | null;
  readonly valueHashed: boolean;
};

export type ProofError = {
  readonly kind: TrieErrorKind;
  readonly message: string;
};

export type ProofResult = {
  readonly status: ProofStatus;
  /** Whether the proof contained a node hashing to the requested root. */
  readonly rootMatches: boolean;
  readonly root: string;
  readonly key: string;
  /** The proven value, or null when nothing was proven. */
  readonly value: Hex | null;
  readonly expectedValue: Hex | null;
  readonly steps: readonly ProofStep[];
  /** Nodes handed to the verifier, as the node returned them. */
  readonly nodesSupplied: number;
  /**
   * Nodes the walk consumed. Inline children are counted here but are not
   * separate proof nodes, so this can exceed `nodesSupplied`; a hashed value
   * node that was resolved is not a walk step, so this can also be lower.
   */
  readonly nodesUsed: number;
  readonly error: ProofError | null;
};

const PLAIN_MASK = 0b1100_0000;
const KIND_LEAF = 0b0100_0000;
const KIND_BRANCH = 0b1000_0000;
const KIND_BRANCH_VALUE = 0b1100_0000;
const HASHED_LEAF_MASK = 0b1110_0000;
const KIND_HASHED_LEAF = 0b0010_0000;
const HASHED_BRANCH_MASK = 0b1111_0000;
const KIND_HASHED_BRANCH = 0b0001_0000;

export type HeaderShape = {
  readonly kind: Exclude<NodeKind, "empty">;
  /** All-ones sentinel for the partial-length field of this kind. */
  readonly max: number;
  readonly hashedValue: boolean;
};

/** Classifies a node header byte. Returns null for the empty node. */
export function classifyHeader(header: number): HeaderShape | null {
  if (header === 0x00) {
    return null;
  }

  if ((header & HASHED_BRANCH_MASK) === KIND_HASHED_BRANCH) {
    return { kind: "hashedBranchWithValue", max: 0x0f, hashedValue: true };
  }

  if ((header & HASHED_LEAF_MASK) === KIND_HASHED_LEAF) {
    return { kind: "hashedLeaf", max: 0x1f, hashedValue: true };
  }

  const plain = header & PLAIN_MASK;

  if (plain === KIND_LEAF) {
    return { kind: "leaf", max: 0x3f, hashedValue: false };
  }

  if (plain === KIND_BRANCH) {
    return { kind: "branch", max: 0x3f, hashedValue: false };
  }

  if (plain === KIND_BRANCH_VALUE) {
    return { kind: "branchWithValue", max: 0x3f, hashedValue: false };
  }

  throw new TrieDecodeError("MALFORMED_NODE", `unknown node header 0x${header.toString(16)}`);
}

/**
 * Reads a SCALE compact length. Trie nodes never use the big-integer mode, so
 * that mode is rejected instead of being silently truncated.
 */
export function decodeCompactLength(
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly next: number } {
  const first = bytes[offset];

  if (first === undefined) {
    throw new TrieDecodeError("MALFORMED_NODE", "truncated compact length");
  }

  const mode = first & 0b11;

  if (mode === 0b00) {
    return { value: first >>> 2, next: offset + 1 };
  }

  if (mode === 0b01) {
    const second = bytes[offset + 1];

    if (second === undefined) {
      throw new TrieDecodeError("MALFORMED_NODE", "truncated two-byte compact length");
    }

    return { value: ((first | (second << 8)) >>> 2) & 0x3fff, next: offset + 2 };
  }

  if (mode === 0b10) {
    if (offset + 4 > bytes.length) {
      throw new TrieDecodeError("MALFORMED_NODE", "truncated four-byte compact length");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    return { value: view.getUint32(0, true) >>> 2, next: offset + 4 };
  }

  throw new TrieDecodeError(
    "MALFORMED_NODE",
    "big-integer compact length is not a valid trie node field",
  );
}

function readPartialLength(
  header: number,
  max: number,
  bytes: Uint8Array,
  offset: number,
): { readonly count: number; readonly next: number } {
  let remaining = header & max;
  let cursor = offset;

  if (remaining !== max) {
    return { count: remaining, next: cursor };
  }

  remaining -= 1;

  for (;;) {
    const byte = bytes[cursor];

    if (byte === undefined) {
      throw new TrieDecodeError(
        "MALFORMED_NODE",
        "truncated partial-key length continuation",
      );
    }

    cursor += 1;

    if (byte === 0xff) {
      remaining += 255;
      continue;
    }

    return { count: remaining + byte + 1, next: cursor };
  }
}

function readPartial(
  bytes: Uint8Array,
  offset: number,
  count: number,
): { readonly partial: readonly number[]; readonly next: number } {
  const byteCount = Math.ceil(count / 2);
  const end = offset + byteCount;

  if (end > bytes.length) {
    throw new TrieDecodeError("MALFORMED_NODE", "partial key runs past the node");
  }

  const nibbles = toNibbles(bytes.subarray(offset, end));

  if (count % 2 === 1) {
    // The pad nibble sits at the FRONT of the packed partial key.
    const pad = nibbles[0] ?? 0;

    if (pad !== 0) {
      throw new TrieDecodeError(
        "MALFORMED_NODE",
        `partial key of ${count} nibbles carries a non-zero pad nibble 0x${pad.toString(16)}`,
      );
    }

    return { partial: nibbles.slice(nibbles.length - count), next: end };
  }

  return { partial: nibbles, next: end };
}

function readInlineValue(
  bytes: Uint8Array,
  offset: number,
): { readonly value: ValueRef; readonly next: number } {
  const { value: length, next } = decodeCompactLength(bytes, offset);
  const end = next + length;

  if (end > bytes.length) {
    throw new TrieDecodeError("MALFORMED_NODE", "value length runs past the node");
  }

  return { value: { kind: "inline", bytes: bytes.subarray(next, end) }, next: end };
}

function readHashedValue(
  bytes: Uint8Array,
  offset: number,
): { readonly value: ValueRef; readonly next: number } {
  const end = offset + 32;

  if (end > bytes.length) {
    throw new TrieDecodeError("MALFORMED_NODE", "hashed value reference is truncated");
  }

  return { value: { kind: "hashed", hash: bytes.subarray(offset, end) }, next: end };
}

function readChild(
  bytes: Uint8Array,
  offset: number,
): { readonly child: ChildRef; readonly next: number } {
  const { value: length, next } = decodeCompactLength(bytes, offset);

  if (length === 32) {
    const end = next + 32;

    if (end > bytes.length) {
      throw new TrieDecodeError("MALFORMED_NODE", "child hash reference is truncated");
    }

    return { child: { kind: "hash", hash: bytes.subarray(next, end) }, next: end };
  }

  if (length === 0) {
    throw new TrieDecodeError("MALFORMED_NODE", "child reference has zero length");
  }

  const end = next + length;

  if (end > bytes.length) {
    throw new TrieDecodeError("MALFORMED_NODE", "inline child node runs past the node");
  }

  return { child: { kind: "inline", node: bytes.subarray(next, end) }, next: end };
}

/** Decodes one proof node. Never walks; the caller resolves hashed references. */
export function decodeNode(bytes: Uint8Array): DecodedNode {
  const header = bytes[0];

  if (header === undefined) {
    throw new TrieDecodeError("MALFORMED_NODE", "empty node");
  }

  const shape = classifyHeader(header);

  if (shape === null) {
    if (bytes.length !== 1) {
      throw new TrieDecodeError(
        "MALFORMED_NODE",
        `empty node carries ${bytes.length - 1} trailing bytes`,
      );
    }

    return { kind: "empty", header: "empty", partial: [] };
  }

  const length = readPartialLength(header, shape.max, bytes, 1);
  const parsed = readPartial(bytes, length.next, length.count);
  let offset = parsed.next;

  if (shape.kind === "leaf" || shape.kind === "hashedLeaf") {
    const read = shape.hashedValue ? readHashedValue : readInlineValue;
    const { value, next } = read(bytes, offset);

    if (next !== bytes.length) {
      throw new TrieDecodeError(
        "MALFORMED_NODE",
        `leaf node has ${bytes.length - next} trailing bytes`,
      );
    }

    return { kind: "leaf", header: shape.kind, partial: parsed.partial, value };
  }

  if (offset + 2 > bytes.length) {
    throw new TrieDecodeError("MALFORMED_NODE", "truncated child bitmap");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2);
  const bitmap = view.getUint16(0, true);
  offset += 2;

  const carriesValue = shape.kind === "branchWithValue" || shape.kind === "hashedBranchWithValue";
  let value: ValueRef | null = null;

  // sp-trie writes the branch value immediately after the bitmap, before the
  // child references. Reading children first shifts every reference and turns a
  // present key into a false absence, which is a fail-open result for Rule 2.
  if (carriesValue) {
    const read = shape.hashedValue ? readHashedValue : readInlineValue;
    const decoded = read(bytes, offset);
    value = decoded.value;
    offset = decoded.next;
  }

  const children = new Map<number, ChildRef>();

  for (let nibble = 0; nibble < 16; nibble += 1) {
    if ((bitmap & (1 << nibble)) === 0) {
      continue;
    }

    const { child, next } = readChild(bytes, offset);
    children.set(nibble, child);
    offset = next;
  }

  if (offset !== bytes.length) {
    throw new TrieDecodeError(
      "MALFORMED_NODE",
      `branch node has ${bytes.length - offset} trailing bytes`,
    );
  }

  return { kind: "branch", header: shape.kind, partial: parsed.partial, value, children };
}

/** blake2_256, the state-trie hasher. Not blake2b-512, not Keccak. */
export function hashNode(bytes: Uint8Array): Uint8Array {
  return blake2AsU8a(bytes, 256);
}

class ProofIndex {
  readonly #nodes = new Map<string, Uint8Array>();

  add(node: Uint8Array): void {
    const key = bytesToHex(blake2AsU8a(node, 256));
    const existing = this.#nodes.get(key);

    if (existing !== undefined && !equalBytes(existing, node)) {
      throw new TrieDecodeError("DUPLICATE_NODE", `two different nodes hash to ${key}`);
    }

    this.#nodes.set(key, node);
  }

  get(hash: Uint8Array): Uint8Array | undefined {
    return this.#nodes.get(bytesToHex(hash));
  }
}

export type VerifyOptions = {
  /** Raw proof nodes, exactly as `state_getReadProof` returns them. */
  readonly proof: readonly Hex[];
  /** The state root the proof must open against. Never taken from a caller. */
  readonly rootHash: Hex;
  readonly key: Hex;
  /**
   * What the caller claims the value is. `null` claims the key is absent;
   * omitting it claims nothing, so the proof is reported as found.
   */
  readonly expectedValue?: Hex | null;
};

export type MutableStep = {
  -readonly [K in keyof ProofStep]: ProofStep[K];
};

function normalizeHex(value: Hex): Hex {
  return bytesToHex(hexToBytes(value));
}

/**
 * Verifies `key` against `rootHash` using only `proof`.
 *
 * Never throws. Every refusal is reported as a structured status plus a
 * machine-readable `error.kind`, so a caller can distinguish "the key is
 * absent", "the proof is truncated" and "the proof lies" without parsing text.
 */
export function verifyStorageProof(options: VerifyOptions): ProofResult {
  const steps: ProofStep[] = [];
  const claimed = options.expectedValue === undefined ? undefined : options.expectedValue;
  const hasClaim = claimed !== undefined;

  const finish = (
    status: ProofStatus,
    extra: {
      readonly value?: Hex | null;
      readonly rootMatches?: boolean;
      readonly error?: ProofError | null;
    } = {},
  ): ProofResult => ({
    status,
    rootMatches: extra.rootMatches ?? rootLookedUp,
    root: options.rootHash,
    key: options.key,
    value: extra.value ?? null,
    expectedValue: hasClaim && claimed !== null ? normalizeHex(claimed) : null,
    steps,
    nodesSupplied: options.proof.length,
    nodesUsed: steps.length,
    error: extra.error ?? null,
  });

  let rootLookedUp = false;

  if (!isHex(options.key) || !isHex(options.rootHash)) {
    return finish("invalid", {
      error: { kind: "INVALID_INPUT", message: "key and rootHash must be even-length 0x hex" },
    });
  }

  if (options.key.length < 4) {
    return finish("invalid", {
      error: { kind: "INVALID_INPUT", message: "key must be at least one byte" },
    });
  }

  if (options.rootHash.length !== 66) {
    return finish("invalid", {
      error: { kind: "INVALID_INPUT", message: "rootHash must be exactly 32 bytes" },
    });
  }

  if (options.proof.length === 0) {
    return finish("incomplete", {
      error: { kind: "EMPTY_PROOF", message: "proof contains no nodes" },
    });
  }

  const index = new ProofIndex();

  try {
    for (const node of options.proof) {
      if (!isHex(node)) {
        return finish("invalid", {
          error: { kind: "INVALID_INPUT", message: "every proof node must be 0x hex" },
        });
      }

      index.add(hexToBytes(node));
    }
  } catch (error) {
    return finish("invalid", {
      error: {
        kind: error instanceof TrieDecodeError ? error.kind : "MALFORMED_NODE",
        message: error instanceof Error ? error.message : "unreadable proof node",
      },
    });
  }

  const keyNibbles = toNibbles(hexToBytes(options.key));
  const rootHash = hexToBytes(options.rootHash);
  const rootNode = index.get(rootHash);

  if (rootNode === undefined) {
    return finish("incomplete", {
      rootMatches: false,
      error: {
        kind: "ROOT_MISSING",
        message: `no supplied node hashes to the requested root ${options.rootHash}`,
      },
    });
  }

  rootLookedUp = true;
  let nodeBytes: Uint8Array = rootNode;

  /** Resolves a value reference, keeping "missing node" distinct from "absent". */
  const resolveValue = (ref: ValueRef): Uint8Array | ProofError => {
    if (ref.kind === "inline") {
      return ref.bytes;
    }

    const resolved = index.get(ref.hash);

    if (resolved === undefined) {
      return {
        kind: "VALUE_NODE_MISSING",
        message: `value node ${bytesToHex(ref.hash)} is not in the proof (incomplete, not absent)`,
      };
    }

    return resolved;
  };

  let position = 0;
  let depth = 0;
  let parentRef: Uint8Array | null = null;

  const walk = (): ProofResult => {
    for (;;) {
      const nodeHash = hashNode(nodeBytes);

      if (parentRef !== null && !equalBytes(nodeHash, parentRef)) {
        return finish("invalid", {
          error: {
            kind: "NODE_HASH_MISMATCH",
            message: `node ${bytesToHex(nodeHash)} does not hash to its parent reference ${bytesToHex(parentRef)}`,
          },
        });
      }

      let node: DecodedNode;

      try {
        node = decodeNode(nodeBytes as Uint8Array);
      } catch (error) {
        return finish("invalid", {
          error: {
            kind: error instanceof TrieDecodeError ? error.kind : "MALFORMED_NODE",
            message: error instanceof Error ? error.message : "unreadable node",
          },
        });
      }

      const carried = node.kind === "empty" ? null : node.value;
      const step: MutableStep = {
        depth,
        node: bytesToHex(nodeHash),
        kind: node.header,
        partial: node.partial.length,
        position: position + node.partial.length,
        bitmap: node.kind === "branch" ? bitmapOf(node) : null,
        childNibble: null,
        valueLength: carried === null ? null : carried.kind === "inline" ? carried.bytes.length : 32,
        valueHashed: carried !== null && carried.kind === "hashed",
      };

      steps.push(step);

      if (node.kind === "empty") {
        return finish("absent", {
          error: { kind: "EMPTY_NODE", message: "proof reached an empty node" },
        });
      }

      for (const [offset, nibble] of node.partial.entries()) {
        if (keyNibbles[position + offset] !== nibble) {
          return finish("absent", {
            error: {
              kind: "PATH_DIVERGED",
              message: `partial key diverges at nibble ${position + offset}`,
            },
          });
        }
      }

      position += node.partial.length;

      if (node.kind === "leaf") {
        if (position !== keyNibbles.length) {
          return finish("absent", {
            error: {
              kind: "PATH_DIVERGED",
              message: `leaf ends at nibble ${position} but the key has ${keyNibbles.length}`,
            },
          });
        }

        const resolved = resolveValue(node.value);

        return isProofError(resolved) ? finish("incomplete", { error: resolved }) : verdict(resolved);
      }

      if (position === keyNibbles.length) {
        if (node.value === null) {
          return finish("absent", {
            error: {
              kind: "BRANCH_WITHOUT_VALUE",
              message: "key ends at a branch that carries no value",
            },
          });
        }

        const resolved = resolveValue(node.value);

        return isProofError(resolved) ? finish("incomplete", { error: resolved }) : verdict(resolved);
      }

      const nextNibble = keyNibbles[position] as number;
      position += 1;
      step.childNibble = nextNibble;

      const child = node.children.get(nextNibble);

      if (child === undefined) {
        return finish("absent", {
          error: { kind: "NO_CHILD", message: `branch has no child for nibble ${nextNibble}` },
        });
      }

      if (child.kind === "inline") {
        nodeBytes = child.node;
        parentRef = null;
      } else {
        const resolved = index.get(child.hash);

        if (resolved === undefined) {
          return finish("incomplete", {
            error: {
              kind: "NODE_MISSING",
              message: `proof is missing node ${bytesToHex(child.hash)}`,
            },
          });
        }

        nodeBytes = resolved;
        parentRef = child.hash;
      }

      depth += 1;
    }
  }

  /** Compares a proven value with the caller's claim. */
  function verdict(bytes: Uint8Array): ProofResult {
    const proven = bytesToHex(bytes);

    if (!hasClaim) {
      return finish("present", { value: proven });
    }

    if (claimed === null) {
      return finish("mismatch", {
        value: proven,
        error: {
          kind: "VALUE_MISMATCH",
          message: `caller expected absence but the proof holds ${proven}`,
        },
      });
    }

    const expectation = normalizeHex(claimed);

    if (proven !== expectation) {
      return finish("mismatch", {
        value: proven,
        error: {
          kind: "VALUE_MISMATCH",
          message: `proof holds ${proven}, claim was ${expectation}`,
        },
      });
    }

    return finish("present", { value: proven });
  }

  return walk();
}

function isProofError(value: Uint8Array | ProofError): value is ProofError {
  return !(value instanceof Uint8Array);
}

function bitmapOf(node: DecodedNode): number {
  if (node.kind !== "branch") {
    return 0;
  }

  let bitmap = 0;

  for (const nibble of node.children.keys()) {
    bitmap |= 1 << nibble;
  }

  return bitmap;
}
