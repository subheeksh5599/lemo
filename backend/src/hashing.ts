// Hashing primitives the Portaldot trie and storage-key layout are built on.
// blake2b comes from @noble/hashes; xxhash64 is implemented here because Node's
// OpenSSL bindings cannot produce the 64-bit variant Substrate uses.

import { blake2b } from "@noble/hashes/blake2.js";
import { bytes } from "./bytes.ts";

const MASK64 = (1n << 64n) - 1n;
const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;

function rotl64(value: bigint, bits: number): bigint {
  return ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & MASK64;
}

function readUint64LE(data: Uint8Array, offset: number): bigint {
  let out = 0n;
  for (let i = 7; i >= 0; i -= 1) out = (out << 8n) | BigInt(data[offset + i] ?? 0);
  return out;
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function round(accumulator: bigint, lane: bigint): bigint {
  const mixed = (accumulator + lane * P2) & MASK64;
  return (rotl64(mixed, 31) * P1) & MASK64;
}

function mergeRound(accumulator: bigint, lane: bigint): bigint {
  const mixed = round(0n, lane);
  return ((accumulator ^ mixed) * P1 + P4) & MASK64;
}

export function xxhash64(data: Uint8Array, seed: bigint): bigint {
  let offset = 0;
  let hash: bigint;

  if (data.length >= 32) {
    let v1 = (seed + P1 + P2) & MASK64;
    let v2 = (seed + P2) & MASK64;
    let v3 = seed;
    let v4 = (seed - P1) & MASK64;

    while (offset + 32 <= data.length) {
      v1 = round(v1, readUint64LE(data, offset));
      v2 = round(v2, readUint64LE(data, offset + 8));
      v3 = round(v3, readUint64LE(data, offset + 16));
      v4 = round(v4, readUint64LE(data, offset + 24));
      offset += 32;
    }

    hash = (rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18)) & MASK64;
    for (const lane of [v1, v2, v3, v4]) hash = mergeRound(hash, lane);
  } else {
    hash = (seed + P5) & MASK64;
  }

  hash = (hash + BigInt(data.length)) & MASK64;

  while (offset + 8 <= data.length) {
    hash ^= round(0n, readUint64LE(data, offset));
    hash = (rotl64(hash, 27) * P1 + P4) & MASK64;
    offset += 8;
  }

  if (offset + 4 <= data.length) {
    hash ^= (BigInt(readUint32LE(data, offset)) * P1) & MASK64;
    hash = (rotl64(hash, 23) * P2 + P3) & MASK64;
    offset += 4;
  }

  while (offset < data.length) {
    hash ^= (BigInt(data[offset] ?? 0) * P5) & MASK64;
    hash = (rotl64(hash, 11) * P1) & MASK64;
    offset += 1;
  }

  hash ^= hash >> 33n;
  hash = (hash * P2) & MASK64;
  hash ^= hash >> 29n;
  hash = (hash * P3) & MASK64;
  hash ^= hash >> 32n;
  return hash;
}

function twox(data: Uint8Array, words: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let seed = 0; seed < words; seed += 1) {
    parts.push(bytes.writeUintLE(xxhash64(data, BigInt(seed)), 8));
  }
  return bytes.concat(...parts);
}

export const hash = {
  blake2b256(data: Uint8Array): Uint8Array {
    return blake2b(data, { dkLen: 32 });
  },

  blake2b128(data: Uint8Array): Uint8Array {
    return blake2b(data, { dkLen: 16 });
  },

  twox64(data: Uint8Array): Uint8Array {
    return twox(data, 1);
  },

  twox128(data: Uint8Array): Uint8Array {
    return twox(data, 2);
  },

  twox256(data: Uint8Array): Uint8Array {
    return twox(data, 4);
  },

  xxhash64,
};
