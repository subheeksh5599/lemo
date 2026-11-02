import test from "node:test";
import assert from "node:assert/strict";
import {
  asHex,
  bytesToHex,
  concatBytes,
  equalBytes,
  hexToBytes,
  isHex,
  readUintLE,
  toNibbles,
} from "../src/util/bytes.ts";

test("hex round-trips, including upper case input", () => {
  assert.equal(bytesToHex(hexToBytes("0x00ff10")), "0x00ff10");
  assert.equal(bytesToHex(hexToBytes("0x00FF10")), "0x00ff10");
  assert.equal(hexToBytes("0x").length, 0);
});

test("isHex accepts 0x prefixed even-length hex only", () => {
  assert.equal(isHex("0x"), true);
  assert.equal(isHex("0x00ff"), true);
  assert.equal(isHex("0x0"), false);
  assert.equal(isHex("00ff"), false);
  assert.equal(isHex("0xzz"), false);
  assert.equal(isHex(12), false);
});

test("hexToBytes refuses a malformed string instead of coercing it", () => {
  assert.throws(() => hexToBytes("0x0" as `0x${string}`), /not a hex string/);
  assert.throws(() => hexToBytes("nope" as `0x${string}`), /not a hex string/);
});

test("nibbles are split high first, which is the order the trie walks", () => {
  assert.deepEqual(toNibbles(hexToBytes("0x1a2b")), [1, 10, 2, 11]);
  assert.deepEqual(toNibbles(hexToBytes("0x")), []);
});

test("byte helpers concatenate and compare without truncation", () => {
  const joined = concatBytes(hexToBytes("0x01"), hexToBytes("0x0203"), new Uint8Array());
  assert.equal(bytesToHex(joined), "0x010203");
  assert.equal(equalBytes(hexToBytes("0xaabb"), hexToBytes("0xaabb")), true);
  assert.equal(equalBytes(hexToBytes("0xaabb"), hexToBytes("0xaabbcc")), false);
  assert.equal(equalBytes(hexToBytes("0xaabb"), hexToBytes("0xaabc")), false);
});

test("readUintLE reads the real System.Number width and refuses short input", () => {
  // 0xb9770400 is the value a live node returned for System.Number.
  assert.equal(readUintLE(hexToBytes("0xb9770400"), 4), 292_793n);
  assert.throws(() => readUintLE(hexToBytes("0x0102"), 4), /expected at least 4 bytes/);
  assert.throws(() => readUintLE(hexToBytes("0x0102"), 8), /expected at least 8 bytes/);
});

test("asHex re-types a validated string without changing it", () => {
  assert.equal(asHex("0xdeadbeef"), "0xdeadbeef");
});
