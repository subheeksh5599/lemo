import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes } from "../src/bytes.ts";
import { hash } from "../src/hashing.ts";
import { decodeStorageValue, LayoutError, storageKey, type FieldSpec } from "../src/storage/layout.ts";

const text = new TextEncoder();
const account = `0x${"11".repeat(32)}`;

const accountField: FieldSpec = {
  label: "owner",
  pallet: "System",
  item: "Account",
  hasher: "blake2_128_concat",
  args: [{ type: "account32", value: account }],
  decode: "bytes",
};

test("a System.Account key is twox128 prefixes plus blake2_128 of the account", () => {
  const key = storageKey(accountField);
  const expected = bytes.concat(
    hash.twox128(text.encode("System")),
    hash.twox128(text.encode("Account")),
    hash.blake2b128(bytes.fromHex(account)),
    bytes.fromHex(account),
  );

  assert.equal(bytes.toHex(key), bytes.toHex(expected));
  assert.equal(key.length, 16 + 16 + 16 + 32);
});

test("a plain storage item has no map segment", () => {
  const number: FieldSpec = {
    label: "revision",
    pallet: "System",
    item: "Number",
    hasher: "identity",
    args: [],
    decode: "u32",
  };
  const key = storageKey(number);
  assert.equal(key.length, 32);
  assert.equal(
    bytes.toHex(key),
    bytes.toHex(bytes.concat(hash.twox128(text.encode("System")), hash.twox128(text.encode("Number")))),
  );
});

test("a Vec<u8> key is length-prefixed before it is hashed", () => {
  const field: FieldSpec = {
    label: "record",
    pallet: "LemoTitles",
    item: "Title",
    hasher: "blake2_256",
    args: [{ type: "vec", value: "0xaabbcc" }],
    decode: "bytes",
  };
  const withPrefix = bytes.concat(Uint8Array.of(12), bytes.fromHex("0xaabbcc"));
  const expected = bytes.concat(
    hash.twox128(text.encode("LemoTitles")),
    hash.twox128(text.encode("Title")),
    hash.blake2b256(withPrefix),
  );
  assert.equal(bytes.toHex(storageKey(field)), bytes.toHex(expected));
});

test("a malformed fixed-width argument is refused at key derivation", () => {
  const short: FieldSpec = { ...accountField, args: [{ type: "hash32", value: "0x1122" }] };
  assert.throws(() => storageKey(short), (cause: unknown) => cause instanceof LayoutError && /32 bytes/.test(cause.message));
});

test("decoded integers must match their declared width", () => {
  const revision: FieldSpec = {
    label: "revision",
    pallet: "System",
    item: "Number",
    hasher: "identity",
    args: [],
    decode: "u32",
  };

  assert.deepEqual(decodeStorageValue(revision, bytes.writeUintLE(7n, 4)), { kind: "integer", value: "7" });
  assert.throws(
    () => decodeStorageValue(revision, bytes.writeUintLE(7n, 8)),
    (cause: unknown) => cause instanceof LayoutError && /declared u32/.test(cause.message),
  );
});
