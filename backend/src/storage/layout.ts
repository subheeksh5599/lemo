// Storage layout: how an LEMO title's records are addressed on Portaldot.
// A pallet item key is twox128(pallet) ++ twox128(item); each map key is then
// hashed with the hasher the runtime declares in its metadata.

import { bytes } from "../bytes.ts";
import { hash } from "../hashing.ts";
import { encodeCompact } from "../scale.ts";

export const HASHERS = [
  "blake2_128",
  "blake2_128_concat",
  "blake2_256",
  "twox64",
  "twox64_concat",
  "twox128",
  "twox256",
  "identity",
] as const;

export type Hasher = (typeof HASHERS)[number];

/** `vec` is a SCALE Vec<u8> key (length prefix); `account32` and `hash32` are raw fixed arrays. */
export type ArgType = "vec" | "account32" | "hash32" | "u32" | "u64" | "u128";
export type ArgSpec = { readonly type: ArgType; readonly value: string };
export type DecodeType = "bytes" | "u32" | "u64" | "u128";

export type FieldSpec = {
  readonly label: string;
  readonly pallet: string;
  readonly item: string;
  readonly hasher: Hasher;
  readonly args: readonly ArgSpec[];
  readonly decode: DecodeType;
};

export type DecodedValue =
  | { readonly kind: "bytes"; readonly hex: string }
  | { readonly kind: "integer"; readonly value: string };

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

const WIDTHS = { u32: 4, u64: 8, u128: 16 } as const;

function encodeArg(arg: ArgSpec): Uint8Array {
  if (arg.type === "u32" || arg.type === "u64" || arg.type === "u128") {
    return writeUint({ value: arg.value, width: WIDTHS[arg.type] });
  }

  const decoded = bytes.fromHex(arg.value);
  if (arg.type === "vec") return bytes.concat(encodeCompact(decoded.length), decoded);
  if (decoded.length !== 32) throw new LayoutError(`${arg.type} must be 32 bytes, got ${decoded.length}`);
  return decoded;
}

function writeUint(input: { readonly value: string; readonly width: number }): Uint8Array {
  let parsed: bigint;
  try {
    parsed = BigInt(input.value);
  } catch {
    throw new LayoutError(`not an integer: ${input.value}`);
  }
  return bytes.writeUintLE(parsed, input.width);
}

function applyHasher(hasher: Hasher, data: Uint8Array): Uint8Array {
  switch (hasher) {
    case "blake2_128":
      return hash.blake2b128(data);
    case "blake2_128_concat":
      return bytes.concat(hash.blake2b128(data), data);
    case "blake2_256":
      return hash.blake2b256(data);
    case "twox64":
      return hash.twox64(data);
    case "twox64_concat":
      return bytes.concat(hash.twox64(data), data);
    case "twox128":
      return hash.twox128(data);
    case "twox256":
      return hash.twox256(data);
    case "identity":
      return data;
  }
}

export function storageKey(field: FieldSpec): Uint8Array {
  if (field.args.length > 0 && field.hasher === "twox128") {
    throw new LayoutError(`${field.label}: twox128 is only used for pallet and item prefixes, not map keys`);
  }

  const text = new TextEncoder();
  const parts: Uint8Array[] = [hash.twox128(text.encode(field.pallet)), hash.twox128(text.encode(field.item))];
  for (const arg of field.args) parts.push(applyHasher(field.hasher, encodeArg(arg)));
  return bytes.concat(...parts);
}

export function decodeStorageValue(field: FieldSpec, raw: Uint8Array): DecodedValue {
  if (field.decode === "bytes") return { kind: "bytes", hex: bytes.toHex(raw) };

  const width = WIDTHS[field.decode];
  if (raw.length !== width) {
    throw new LayoutError(`${field.label}: declared ${field.decode} but the stored value is ${raw.length} bytes`);
  }
  return { kind: "integer", value: bytes.readUintLE(raw).toString(10) };
}
