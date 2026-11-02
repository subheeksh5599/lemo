import { bytesToHex, type Hex } from "../../src/util/bytes.ts";

/**
 * Deterministic support code for the stress suite.
 *
 * Every stress case is generated from a fixed seed, so a failure is
 * reproducible from the case name alone. No Math.random, no wall clock, no
 * network: two runs on two machines produce the same inputs and the same
 * counts.
 */

/** The one seed every stress file derives its stream from. Printed on every run. */
export const STRESS_SEED = 20261102;

/** mulberry32: 32-bit state, uniform doubles in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An independent stream per part, still derived from STRESS_SEED. Part B must
 * not shift Part A's inputs, so each part owns its stream.
 */
export function seeded(stream: number): () => number {
  return mulberry32((STRESS_SEED + stream * 0x9e3779b9) >>> 0);
}

export function logSeed(label: string): void {
  console.log(
    `[stress] ${label} seed=${STRESS_SEED} (0x${STRESS_SEED.toString(16)})`,
  );
}

export function randomInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function randomBytes(rand: () => number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(rand() * 256);
  }

  return bytes;
}

export function randomU32(rand: () => number): number {
  return Math.floor(rand() * 0x1_0000_0000);
}

/** SCALE compact mode for a value the trie decoder accepts (0 .. 2^30 - 1). */
export function compactMode(value: number): 0 | 1 | 2 {
  if (value < 0x40) return 0;
  if (value < 0x4000) return 1;
  if (value <= 0x3fff_ffff) return 2;
  throw new RangeError(`compact value ${value} is outside the three inline modes`);
}

export function compactWidth(value: number): number {
  const mode = compactMode(value);
  return mode === 0 ? 1 : mode === 1 ? 2 : 4;
}

/**
 * SCALE compact encoding for the three inline modes. This is the reference the
 * decoder under test is checked against; it is written from the SCALE spec
 * (value << 2 | mode, little-endian) rather than copied from the decoder.
 */
export function encodeCompactLength(value: number): Uint8Array {
  const mode = compactMode(value);

  if (mode === 0) {
    return Uint8Array.of(value << 2);
  }

  if (mode === 1) {
    const encoded = value * 4 + 1;
    return Uint8Array.of(encoded & 0xff, (encoded >>> 8) & 0xff);
  }

  const encoded = value * 4 + 2;
  return Uint8Array.of(
    encoded & 0xff,
    (encoded >>> 8) & 0xff,
    (encoded >>> 16) & 0xff,
    (encoded >>> 24) & 0xff,
  );
}

/** Little-endian u32 hex, exactly 4 bytes. */
export function u32leHex(value: number): Hex {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`not a u32: ${value}`);
  }

  return bytesToHex(
    Uint8Array.of(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    ),
  );
}

/** Flips exactly one byte, the mutation primitive for the trie cases. */
export function flipByte(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
}

export function bytesFromHex(hex: Hex): Uint8Array {
  const body = hex.slice(2);
  const out = new Uint8Array(body.length / 2);

  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }

  return out;
}
