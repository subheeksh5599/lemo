import { test } from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/hashing.ts";
import { bytes } from "../src/bytes.ts";

const text = new TextEncoder();

test("xxhash64 reproduces the reference vectors", () => {
  assert.equal(hash.xxhash64(new Uint8Array([]), 0n), 0xef46db3751d8e999n);
  assert.equal(hash.xxhash64(new TextEncoder().encode("abc"), 0n), 0x44bc2cf5ad770999n);
});

test("twox128 of the System pallet matches the runtime prefix", () => {
  assert.equal(bytes.toHex(hash.twox128(text.encode("System"))), "0x26aa394eea5630e07c48ae0c9558cef7");
  assert.equal(bytes.toHex(hash.twox128(text.encode("Account"))), "0xb99d880ec681799c0cf30e8886371da9");
});

test("blake2b truncation is not blake2b-512 with a shorter read", () => {
  assert.equal(bytes.toHex(hash.blake2b256(text.encode("abc"))), "0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319");
  assert.equal(hash.blake2b128(text.encode("abc")).length, 16);
});

test("hash helpers reject malformed hex instead of returning zero bytes", () => {
  assert.throws(() => bytes.fromHex("0x12zz"), /not valid hex/);
  assert.throws(() => bytes.fromHex("0x123"), /not valid hex/);
});
