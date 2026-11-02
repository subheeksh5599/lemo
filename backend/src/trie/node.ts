// Decoder for Portaldot's storage trie nodes: radix-16, SCALE-encoded, partial
// keys packed two nibbles per byte, branch children addressed by a bitmap.

import { readCompact } from "../scale.ts";

export type NodeValue =
  | { readonly kind: "inline"; readonly bytes: Uint8Array }
  | { readonly kind: "hashed"; readonly hash: Uint8Array };

export type ChildRef =
  | { readonly kind: "inline"; readonly node: Uint8Array }
  | { readonly kind: "hashed"; readonly hash: Uint8Array };

export type TrieNode =
  | { readonly kind: "empty" }
  | { readonly kind: "leaf"; readonly partial: readonly number[]; readonly value: NodeValue }
  | {
      readonly kind: "branch";
      readonly partial: readonly number[];
      readonly value: NodeValue | null;
      readonly children: readonly (ChildRef | null)[];
    };

const HASH_LENGTH = 32;
const BITMAP_LENGTH = 2;

class Cursor {
  offset = 0;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  byte(): number {
    const value = this.data[this.offset];
    if (value === undefined) throw new Error("trie node: out of data");
    this.offset += 1;
    return value;
  }

  take(count: number): Uint8Array {
    if (this.offset + count > this.data.length) throw new Error("trie node: out of data");
    const out = this.data.slice(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }

  compact(): number {
    const { value, size } = readCompact(this.data, this.offset);
    this.offset += size;
    return value;
  }
}

type Header =
  | { readonly kind: "empty" }
  | { readonly kind: "leaf"; readonly nibbles: number; readonly hashedValue: boolean }
  | { readonly kind: "branch"; readonly nibbles: number; readonly hasValue: boolean; readonly hashedValue: boolean };

function decodeSize(first: number, prefixBits: number, cursor: Cursor): number {
  const maxValue = 0xff >> prefixBits;
  let result = first & maxValue;
  if (result < maxValue) return result;

  result -= 1;
  for (;;) {
    const next = cursor.byte();
    if (next < 0xff) return result + next + 1;
    result += 255;
  }
}

function decodeHeader(cursor: Cursor): Header {
  const first = cursor.byte();
  if (first === 0x00) return { kind: "empty" };

  const tag = first & 0b1100_0000;
  if (tag === 0b0100_0000) {
    return { kind: "leaf", nibbles: decodeSize(first, 2, cursor), hashedValue: false };
  }
  if (tag === 0b1100_0000) {
    return { kind: "branch", nibbles: decodeSize(first, 2, cursor), hasValue: true, hashedValue: false };
  }
  if (tag === 0b1000_0000) {
    return { kind: "branch", nibbles: decodeSize(first, 2, cursor), hasValue: false, hashedValue: false };
  }
  if (tag !== 0x00) throw new Error("trie node: unknown header tag");

  if ((first & 0b1110_0000) === 0b0010_0000) {
    return { kind: "leaf", nibbles: decodeSize(first, 3, cursor), hashedValue: true };
  }
  if ((first & 0b1111_0000) === 0b0001_0000) {
    return { kind: "branch", nibbles: decodeSize(first, 4, cursor), hasValue: true, hashedValue: true };
  }
  throw new Error("trie node: unknown header tag");
}

function decodePartial(cursor: Cursor, count: number): number[] {
  const width = Math.ceil(count / 2);
  const packed = cursor.take(width);
  const padding = count % 2;
  if (padding === 1 && ((packed[0] ?? 0) >> 4) !== 0) {
    throw new Error("trie node: partial key has a non-zero pad nibble");
  }

  const nibbles: number[] = [];
  for (const byte of packed) nibbles.push(byte >> 4, byte & 0x0f);
  return nibbles.slice(padding, padding + count);
}

function decodeValue(cursor: Cursor, hashedValue: boolean): NodeValue {
  if (hashedValue) return { kind: "hashed", hash: cursor.take(HASH_LENGTH) };
  const length = cursor.compact();
  return { kind: "inline", bytes: cursor.take(length) };
}

export function decodeNode(data: Uint8Array): TrieNode {
  const cursor = new Cursor(data);
  const header = decodeHeader(cursor);

  if (header.kind === "empty") {
    if (cursor.remaining !== 0) throw new Error("trie node: trailing bytes after empty node");
    return { kind: "empty" };
  }

  const partial = decodePartial(cursor, header.nibbles);

  if (header.kind === "leaf") {
    return { kind: "leaf", partial, value: decodeValue(cursor, header.hashedValue) };
  }

  const bitmapBytes = cursor.take(BITMAP_LENGTH);
  const bitmap = (bitmapBytes[0] ?? 0) | ((bitmapBytes[1] ?? 0) << 8);
  if (bitmap === 0) throw new Error("trie node: branch without children");

  const value = header.hasValue ? decodeValue(cursor, header.hashedValue) : null;
  const children: (ChildRef | null)[] = [];
  for (let nibble = 0; nibble < 16; nibble += 1) {
    if ((bitmap & (1 << nibble)) === 0) {
      children.push(null);
      continue;
    }
    const length = cursor.compact();
    const payload = cursor.take(length);
    children.push(length === HASH_LENGTH ? { kind: "hashed", hash: payload } : { kind: "inline", node: payload });
  }

  if (cursor.remaining !== 0) throw new Error("trie node: trailing bytes after branch");
  return { kind: "branch", partial, value, children };
}
