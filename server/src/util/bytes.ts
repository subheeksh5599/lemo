export type Hex = `0x${string}`;

/** Re-types an already-validated hex string. Validation happens at the edge. */
export function asHex(value: string): Hex {
  return value as Hex;
}

const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;

export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && HEX_PATTERN.test(value) && value.length % 2 === 0;
}

export function hexToBytes(value: Hex): Uint8Array {
  if (!isHex(value)) {
    throw new TypeError(`not a hex string: ${String(value)}`);
  }

  const body = value.slice(2);
  const bytes = new Uint8Array(body.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  let body = "";

  for (const byte of bytes) {
    body += byte.toString(16).padStart(2, "0");
  }

  return `0x${body}`;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

/** Splits a key into its high and low nibbles, the unit a trie walks. */
export function toNibbles(bytes: Uint8Array): number[] {
  const nibbles: number[] = new Array(bytes.length * 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    nibbles[index * 2] = byte >> 4;
    nibbles[index * 2 + 1] = byte & 0x0f;
  }

  return nibbles;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/**
 * Reads an unsigned little-endian integer. A width mismatch is an error, never
 * a silently shorter read: `System.Number` is a u32, and decoding its 4 bytes
 * as anything else produces a plausible wrong block number.
 */
export function readUintLE(bytes: Uint8Array, width: 4 | 8 | 16): bigint {
  if (bytes.length < width) {
    throw new RangeError(`expected at least ${width} bytes, got ${bytes.length}`);
  }

  let value = 0n;

  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }

  return value;
}

