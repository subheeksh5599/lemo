// Byte helpers shared by the hashing, key and trie layers.

const HEX = /^(?:0x)?(?:[0-9a-fA-F]{2})*$/;

export const bytes = {
  fromHex(value: string): Uint8Array {
    if (!HEX.test(value)) throw new Error(`not valid hex: ${value.slice(0, 40)}`);
    const body = value.startsWith("0x") ? value.slice(2) : value;
    const out = new Uint8Array(body.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  },

  toHex(value: Uint8Array): string {
    let out = "";
    for (const byte of value) out += byte.toString(16).padStart(2, "0");
    return `0x${out}`;
  },

  concat(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  },

  equal(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  },

  readUintLE(value: Uint8Array): bigint {
    let out = 0n;
    for (let i = value.length - 1; i >= 0; i -= 1) out = (out << 8n) | BigInt(value[i] ?? 0);
    return out;
  },

  writeUintLE(value: bigint, width: number): Uint8Array {
    if (value < 0n) throw new Error("uint cannot be negative");
    if (value >= 1n << BigInt(width * 8)) throw new Error(`value does not fit in ${width} bytes`);
    const out = new Uint8Array(width);
    let rest = value;
    for (let i = 0; i < width; i += 1) {
      out[i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return out;
  },

  /** Nibbles of a key, high nibble first, as the trie walks them. */
  nibbles(value: Uint8Array): number[] {
    const out: number[] = [];
    for (const byte of value) out.push(byte >> 4, byte & 0x0f);
    return out;
  },
};
