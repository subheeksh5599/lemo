import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCompact, readCompact } from "../src/scale.ts";

test("compact length encoding round-trips every boundary", () => {
  for (const value of [0, 1, 63, 64, 16_383, 16_384, 1_000_000, 2 ** 30 - 1]) {
    const encoded = encodeCompact(value);
    assert.equal(readCompact(encoded, 0).value, value, `round-trip failed at ${value}`);
    assert.equal(readCompact(encoded, 0).size, encoded.length);
  }
});

test("compact encoding uses the smallest legal form", () => {
  assert.equal(encodeCompact(63).length, 1);
  assert.equal(encodeCompact(64).length, 2);
  assert.equal(encodeCompact(16_384).length, 4);
});

test("compact decoding refuses truncated and non-integer input", () => {
  assert.throws(() => readCompact(new Uint8Array([]), 0), /out of data/);
  assert.throws(() => readCompact(Uint8Array.from([0b01]), 0), /out of data/);
  assert.throws(() => encodeCompact(-1), /non-negative/);
  assert.throws(() => encodeCompact(1.5), /non-negative integer/);
});
