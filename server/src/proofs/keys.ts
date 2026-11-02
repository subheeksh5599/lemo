import { blake2AsU8a, xxhashAsU8a } from "@polkadot/util-crypto";
import { bytesToHex, concatBytes, hexToBytes, type Hex } from "../util/bytes.ts";

/**
 * Storage-key derivation for Substrate state.
 *
 * A pallet item lives at `twox128(pallet) ++ twox128(item)`; a map key appends
 * the configured hasher over the encoded key. `twox128` is xxhash64 with seeds
 * 0..3, NOT blake2-128: the two are different 16-byte prefixes and mixing them
 * up makes every read return null while `state_getReadProof` still answers with
 * a perfectly valid non-inclusion witness.
 *
 * The vectors below are asserted in `test/keys.test.ts`.
 */

export type MapHasher =
  | "Blake2_128"
  | "Blake2_128Concat"
  | "Blake2_256"
  | "Twox64"
  | "Twox64Concat"
  | "Twox128"
  | "Twox256"
  | "Identity";

export function twox128(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return xxhashAsU8a(bytes, 128);
}

export function palletItemKey(pallet: string, item: string): Hex {
  return bytesToHex(concatBytes(twox128(pallet), twox128(item)));
}

/** The storage key of `System.Number`, a plain u32, present in every block. */
export const SYSTEM_NUMBER_KEY: Hex = palletItemKey("System", "Number");

/** The `System.Account` map prefix, with the map hasher left off. */
export const SYSTEM_ACCOUNT_PREFIX: Hex = palletItemKey("System", "Account");

/**
 * Applies a storage-map hasher to an already-encoded key.
 *
 * `Blake2_128` and `Blake2_128Concat` are different layouts (bare hash versus
 * hash ++ key). Passing the wrong one yields a key the chain has never seen,
 * which reads back as "no such record" rather than as an error.
 */
export function applyHasher(hasher: MapHasher, key: Uint8Array): Uint8Array {
  switch (hasher) {
    case "Identity":
      return key;
    case "Blake2_128":
      return blake2AsU8a(key, 128);
    case "Blake2_128Concat":
      return concatBytes(blake2AsU8a(key, 128), key);
    case "Blake2_256":
      return blake2AsU8a(key, 256);
    case "Twox64":
      return xxhashAsU8a(key, 64);
    case "Twox64Concat":
      return concatBytes(xxhashAsU8a(key, 64), key);
    case "Twox128":
      return xxhashAsU8a(key, 128);
    case "Twox256":
      return xxhashAsU8a(key, 256);
    default: {
      const exhaustive: never = hasher;
      throw new Error(`unsupported storage hasher ${String(exhaustive)}`);
    }
  }
}

/** Builds a map storage key: pallet prefix, item prefix, hashed key segment. */
export function mapStorageKey(options: {
  readonly pallet: string;
  readonly item: string;
  readonly hasher: MapHasher;
  readonly key: Hex;
}): Hex {
  const prefix = hexToBytes(palletItemKey(options.pallet, options.item));
  return bytesToHex(concatBytes(prefix, applyHasher(options.hasher, hexToBytes(options.key))));
}
