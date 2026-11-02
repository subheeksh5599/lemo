// Proof verification: a read proof is a set of trie nodes. Every node is indexed
// by the blake2b-256 hash of its own encoding, so the only root that can be
// reached is the one the node set actually encodes. A node that is missing from
// the set can never be invented, which is what lets a client trust a proof from
// an RPC it does not trust.

import { bytes } from "../bytes.ts";
import { hash } from "../hashing.ts";
import { decodeNode, type ChildRef, type NodeValue, type TrieNode } from "./node.ts";

export type ProofErrorCode =
  | "EMPTY_PROOF"
  | "ROOT_NOT_IN_PROOF"
  | "NODE_DECODE"
  | "PATH_INCOMPLETE"
  | "KEY_MISMATCH";

export class ProofError extends Error {
  readonly code: ProofErrorCode;

  constructor(code: ProofErrorCode, message: string) {
    super(message);
    this.name = "ProofError";
    this.code = code;
  }
}

export type Lookup =
  | { readonly status: "present"; readonly value: Uint8Array }
  | { readonly status: "absent" }
  | { readonly status: "incomplete"; readonly missing: string };

export type Proof = {
  readonly stateRoot: string;
  readonly nodes: number;
  lookup(key: Uint8Array): Lookup;
  /** The value node a hashed inline value points at, when the proof carries it. */
  readonly rootHash: string;
};

function nodeKey(node: Uint8Array): string {
  return bytes.toHex(hash.blake2b256(node));
}

function decode(node: Uint8Array): TrieNode {
  try {
    return decodeNode(node);
  } catch (cause) {
    throw new ProofError("NODE_DECODE", cause instanceof Error ? cause.message : "unreadable trie node");
  }
}

export function openProof(nodes: readonly Uint8Array[], stateRoot: Uint8Array): Proof {
  if (nodes.length === 0) throw new ProofError("EMPTY_PROOF", "proof carries no nodes");

  const index = new Map<string, Uint8Array>();
  for (const node of nodes) index.set(nodeKey(node), node);

  const rootHash = bytes.toHex(stateRoot);
  const rootNode = index.get(rootHash);
  if (rootNode === undefined) {
    throw new ProofError(
      "ROOT_NOT_IN_PROOF",
      `no proof node hashes to the state root ${rootHash}; the proof does not belong to this block`,
    );
  }

  const resolve = (reference: ChildRef): Uint8Array => {
    if (reference.kind === "inline") return reference.node;
    const found = index.get(bytes.toHex(reference.hash));
    if (found === undefined) {
      throw new ProofError("PATH_INCOMPLETE", `node ${bytes.toHex(reference.hash)} missing from proof`);
    }
    return found;
  };

  const walk = (nodeBytes: Uint8Array, path: readonly number[], depth: number): Lookup => {
    const node = decode(nodeBytes);

    if (node.kind === "empty") return { status: "absent" };

    for (let i = 0; i < node.partial.length; i += 1) {
      if (path[depth + i] !== node.partial[i]) return { status: "absent" };
    }

    const nextDepth = depth + node.partial.length;

    if (node.kind === "leaf") {
      if (nextDepth !== path.length) return { status: "absent" };
      return valueOf(node.value);
    }

    if (nextDepth === path.length) {
      return node.value === null ? { status: "absent" } : valueOf(node.value);
    }

    const branch = path[nextDepth];
    if (branch === undefined) throw new ProofError("KEY_MISMATCH", "key path ended inside a branch");
    const child = node.children[branch];
    if (child === null || child === undefined) return { status: "absent" };

    return walk(resolve(child), path, nextDepth + 1);
  };

  const valueOf = (value: NodeValue): Lookup => {
    if (value.kind === "inline") return { status: "present", value: value.bytes };
    const found = index.get(bytes.toHex(value.hash));
    if (found === undefined) {
      return { status: "incomplete", missing: bytes.toHex(value.hash) };
    }
    return { status: "present", value: found };
  };

  return {
    stateRoot: rootHash,
    rootHash,
    nodes: nodes.length,
    lookup(key: Uint8Array): Lookup {
      return walk(rootNode, bytes.nibbles(key), 0);
    },
  };
}
