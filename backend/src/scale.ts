// SCALE primitives needed on the wire: the compact integer used for lengths and
// inline values, and the fixed-width little-endian integers the storage values use.

export type Compact = { readonly value: number; readonly size: number };

export function readCompact(data: Uint8Array, offset: number): Compact {
  const first = data[offset];
  if (first === undefined) throw new Error("compact: out of data");

  const mode = first & 0b11;
  if (mode === 0b00) return { value: first >> 2, size: 1 };

  if (mode === 0b01) {
    const second = data[offset + 1];
    if (second === undefined) throw new Error("compact: out of data");
    return { value: ((first | (second << 8)) >>> 2) & 0x3fff, size: 2 };
  }

  if (mode === 0b10) {
    if (offset + 4 > data.length) throw new Error("compact: out of data");
    const word = (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16) | ((data[offset + 3] ?? 0) << 24);
    return { value: word >>> 2, size: 4 };
  }

  const width = (first >>> 2) + 4;
  if (offset + 1 + width > data.length) throw new Error("compact: out of data");
  let value = 0n;
  for (let i = width - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(data[offset + 1 + i] ?? 0);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("compact: value exceeds safe integer range");
  return { value: Number(value), size: 1 + width };
}

export function encodeCompact(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error("compact: value must be a non-negative integer");

  if (value < 1 << 6) {
    const out = new Uint8Array(1);
    out[0] = value << 2;
    return out;
  }

  if (value < 1 << 14) {
    const encoded = ((value << 2) | 0b01) >>> 0;
    return Uint8Array.from([encoded & 0xff, (encoded >>> 8) & 0xff]);
  }

  if (value < 1 << 30) {
    const encoded = ((value << 2) | 0b10) >>> 0;
    const out = new Uint8Array(4);
    for (let i = 0; i < 4; i += 1) out[i] = (encoded >>> (i * 8)) & 0xff;
    return out;
  }

  throw new Error("compact: value above 2^30 is not used by this protocol");
}
