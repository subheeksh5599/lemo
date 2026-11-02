import { hexToBytes, readUintLE, type Hex } from "../util/bytes.ts";
import { SYSTEM_NUMBER_KEY } from "./keys.ts";

/**
 * Typed decoding of proven storage values.
 *
 * A Merkle value proves bytes. Turning those bytes into a typed field is a
 * second, separately fallible step: the block number is a plain little-endian
 * u32, and reading it as a SCALE compact (or as a u64) yields a plausible but
 * wrong number. Unknown keys are returned as raw hex with no invented type,
 * and a length mismatch is a note on the reading rather than a dropped field.
 */

export type DecodedValue = {
  /** Human name of the storage item, when the key is recognised. */
  readonly label: string | null;
  /** How the bytes were interpreted, or "opaque" for unknown keys. */
  readonly encoding: string;
  /** The decoded value when the encoding is known and the length matches. */
  readonly value: number | string | null;
  /** Anything the decode could not do. Never silently dropped. */
  readonly note: string | null;
};

const SYSTEM_NUMBER = SYSTEM_NUMBER_KEY.toLowerCase();

export function decodeStorageValue(key: string, value: Hex): DecodedValue {
  if (key.toLowerCase() === SYSTEM_NUMBER) {
    const bytes = hexToBytes(value);

    if (bytes.length !== 4) {
      return {
        label: "System.Number",
        encoding: "u32-le",
        value: null,
        note: `expected 4 bytes for System.Number, got ${bytes.length}`,
      };
    }

    return {
      label: "System.Number",
      encoding: "u32-le",
      value: Number(readUintLE(bytes, 4)),
      note: null,
    };
  }

  return {
    label: describeKey(key),
    encoding: "opaque",
    value: value,
    note: "no typed decoder for this key; value is returned as raw hex",
  };
}

const KNOWN_ITEMS: readonly { readonly key: Hex; readonly label: string }[] = [
  { key: SYSTEM_NUMBER_KEY, label: "System.Number" },
];

export function describeKey(key: string): string | null {
  const normalized = key.toLowerCase();
  const known = KNOWN_ITEMS.find((entry) => entry.key.toLowerCase() === normalized);
  return known?.label ?? null;
}

/** True when the block number a proof returned equals the block's own number. */
export function blockNumberAgrees(decoded: DecodedValue, blockNumber: number): boolean {
  return decoded.encoding === "u32-le" && decoded.value === blockNumber;
}
