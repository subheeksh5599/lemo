import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeCompactLength,
  decodeNode,
  TrieDecodeError,
  type TrieErrorKind,
} from "../../src/proofs/trie.ts";
import { bytesToHex, hexToBytes, type Hex } from "../../src/util/bytes.ts";
import {
  compactMode,
  compactWidth,
  encodeCompactLength,
  logSeed,
  randomBytes,
  randomInt,
  seeded,
} from "./support.ts";

/**
 * Stress part A: SCALE compact lengths used as trie node fields.
 *
 * For every case: decode(encode(x)) === x, the returned `next` offset is
 * exactly offset + the encoded width, and decode neither reads before the
 * offset nor writes to the buffer.
 *
 * Stress part B: negative compact inputs. 120 truncations, 40 big-integer
 * forms and 40 malformed node bodies, each asserting the exact
 * TrieDecodeError kind and message.
 */

logSeed("compact");

/* ------------------------------------------------------------------ part A */

type CompactCase = {
  readonly value: number;
  readonly offset: number;
  readonly prefix: Uint8Array;
};

const BOUNDARIES: readonly number[] = [
  0,
  1,
  63,
  64,
  255,
  16_383,
  16_384,
  0x3fff_ffff,
];

function buildCompactCases(): CompactCase[] {
  const rand = seeded(1);
  const cases: CompactCase[] = [];
  const usedValues = new Set<number>();

  const push = (value: number): void => {
    const offset = randomInt(rand, 0, 7);
    cases.push({ value, offset, prefix: randomBytes(rand, offset) });
    usedValues.add(value);
  };

  for (const value of BOUNDARIES) {
    push(value);
  }

  while (cases.length < 300) {
    const mode = randomInt(rand, 0, 2) as 0 | 1 | 2;
    const value =
      mode === 0
        ? randomInt(rand, 0, 0x3f)
        : mode === 1
          ? randomInt(rand, 0x40, 0x3fff)
          : randomInt(rand, 0x4000, 0x3fff_ffff);

    if (usedValues.has(value)) {
      continue;
    }

    push(value);
  }

  return cases;
}

const compactCases = buildCompactCases();

test("A: 300 SCALE compact length round-trips", async (t) => {
  logSeed("compact/A");

  for (const [index, entry] of compactCases.entries()) {
    const { value, offset, prefix } = entry;
    const mode = compactMode(value);

    await t.test(
      `A#${String(index + 1).padStart(3, "0")} value=${value} mode=${mode} offset=${offset}`,
      () => {
        const encoded = encodeCompactLength(value);

        assert.equal(
          encoded.length,
          compactWidth(value),
          `compact(${value}) must use ${compactWidth(value)} byte(s)`,
        );

        // decode() must not look left of `offset`: the prefix can hold bytes
        // that are themselves valid compact prefixes (including mode 11).
        const body = new Uint8Array(offset + encoded.length + 2);
        body.set(prefix, 0);
        body.set(encoded, offset);
        body[offset + encoded.length] = 0xaa;
        body[offset + encoded.length + 1] = 0x55;
        const before = body.slice();

        const decoded = decodeCompactLength(body, offset);

        assert.deepEqual(body, before, "decodeCompactLength must not mutate its input");
        assert.equal(decoded.value, value, "decoded value must equal the encoded value");
        assert.equal(
          decoded.next,
          offset + encoded.length,
          "next offset must be offset + encoded width",
        );
        assert.equal(
          body[offset + encoded.length],
          0xaa,
          "the byte after the compact field must be left untouched",
        );
        assert.deepEqual(
          encodeCompactLength(decoded.value),
          encoded,
          "re-encoding the decoded value must reproduce the exact bytes",
        );
        assert.deepEqual(
          body.subarray(0, offset),
          prefix,
          "bytes before the offset must be ignored",
        );
      },
    );
  }

  assert.equal(compactCases.length, 300);
});

test("A: the boundary vectors are the SCALE spec bytes", () => {
  const expected: readonly [number, Hex][] = [
    [0, "0x00"],
    [1, "0x04"],
    [63, "0xfc"],
    [64, "0x0101"],
    [255, "0xfd03"],
    [16_383, "0xfdff"],
    [16_384, "0x02000100"],
    [0x3fff_ffff, "0xfeffffff"],
  ];

  for (const [value, hex] of expected) {
    assert.equal(bytesToHex(encodeCompactLength(value)), hex);
    assert.deepEqual(decodeCompactLength(hexToBytes(hex), 0), {
      value,
      next: (hex.length - 2) / 2,
    });
  }
});

/* ------------------------------------------------------------------ part B */

type NegativeCase = {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly offset: number;
  readonly expectedKind: TrieErrorKind;
  readonly expectedMessage: RegExp;
  /** Compact-level failures call decodeCompactLength; node-level decodeNode. */
  readonly level: "compact" | "node";
};

function buildNegativeCases(): NegativeCase[] {
  const rand = seeded(2);
  const cases: NegativeCase[] = [];

  // 40 truncations with the offset exactly at the end of the buffer.
  for (let index = 0; index < 40; index += 1) {
    const bytes = randomBytes(rand, index);
    cases.push({
      id: `truncated-empty-offset-${index}`,
      bytes,
      offset: bytes.length,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^truncated compact length$/,
      level: "compact",
    });
  }

  // 40 two-byte forms whose second byte is missing. First byte is mode 01,
  // the 64 legal values 0x01, 0x05, ... 0xfd; the stride makes them distinct.
  for (let index = 0; index < 40; index += 1) {
    const prefix = randomBytes(rand, index % 5);
    const first = 0x01 + 4 * ((index * 7) % 64);
    const bytes = new Uint8Array(prefix.length + 1);
    bytes.set(prefix, 0);
    bytes[prefix.length] = first;
    cases.push({
      id: `truncated-two-byte-${index}-first=0x${first.toString(16)}`,
      bytes,
      offset: prefix.length,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^truncated two-byte compact length$/,
      level: "compact",
    });
  }

  // 40 four-byte forms with only 1..3 bytes present.
  for (let index = 0; index < 40; index += 1) {
    const prefix = randomBytes(rand, index % 4);
    const trailing = 1 + (index % 3);
    const first = 0x02 + 4 * (index % 64);
    const bytes = new Uint8Array(prefix.length + trailing);
    bytes.set(prefix, 0);
    bytes[prefix.length] = first;
    for (let tail = 1; tail < trailing; tail += 1) {
      bytes[prefix.length + tail] = Math.floor(rand() * 256);
    }
    cases.push({
      id: `truncated-four-byte-${index}-present=${trailing}`,
      bytes,
      offset: prefix.length,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^truncated four-byte compact length$/,
      level: "compact",
    });
  }

  // 40 big-integer (mode 11) first bytes: all 64 legal values are 3 + 4k.
  for (let index = 0; index < 40; index += 1) {
    const prefix = randomBytes(rand, index % 3);
    const first = 0x03 + 4 * ((index * 5) % 64);
    const tail = randomBytes(rand, index % 4);
    const bytes = new Uint8Array(prefix.length + 1 + tail.length);
    bytes.set(prefix, 0);
    bytes[prefix.length] = first;
    bytes.set(tail, prefix.length + 1);
    cases.push({
      id: `big-integer-${index}-first=0x${first.toString(16)}`,
      bytes,
      offset: prefix.length,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^big-integer compact length is not a valid trie node field$/,
      level: "compact",
    });
  }

  // 8 empty nodes with trailing bytes.
  for (let index = 1; index <= 8; index += 1) {
    const tail = randomBytes(rand, index);
    const bytes = new Uint8Array(1 + tail.length);
    bytes[0] = 0x00;
    bytes.set(tail, 1);
    cases.push({
      id: `malformed-empty-trailing-${index}`,
      bytes,
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: new RegExp(`^empty node carries ${index} trailing bytes$`),
      level: "node",
    });
  }

  // 8 leaves whose partial key length runs past the node.
  for (let count = 1; count <= 8; count += 1) {
    cases.push({
      id: `malformed-partial-past-end-${count}`,
      bytes: Uint8Array.of(0x40 | count),
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^partial key runs past the node$/,
      level: "node",
    });
  }

  // 8 one-nibble partial keys with a non-zero pad nibble.
  for (let nibble = 1; nibble <= 8; nibble += 1) {
    cases.push({
      id: `malformed-pad-nibble-${nibble}`,
      bytes: Uint8Array.of(0x41, (nibble << 4) | nibble),
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^partial key of 1 nibbles carries a non-zero pad nibble/,
      level: "node",
    });
  }

  // 6 branches with a one-byte child bitmap.
  for (let index = 0; index < 6; index += 1) {
    cases.push({
      id: `malformed-truncated-bitmap-${index}`,
      bytes: Uint8Array.of(0x80, index + 1),
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^truncated child bitmap$/,
      level: "node",
    });
  }

  // 4 branches whose only child reference has zero length.
  for (const bitmapByte of [0x01, 0x02, 0x04, 0x08]) {
    cases.push({
      id: `malformed-zero-length-child-0x${bitmapByte.toString(16)}`,
      bytes: Uint8Array.of(0x80, bitmapByte, 0x00, 0x00),
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^child reference has zero length$/,
      level: "node",
    });
  }

  // 3 hashed leaves whose 32-byte value reference is truncated.
  for (let index = 0; index < 3; index += 1) {
    const body = new Uint8Array(1 + 31);
    body[0] = 0x20;
    body.fill(0xa0 + index, 1);
    cases.push({
      id: `malformed-hashed-value-truncated-${index}`,
      bytes: body,
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: /^hashed value reference is truncated$/,
      level: "node",
    });
  }

  // 3 branches with no children and trailing bytes after the bitmap.
  for (let index = 1; index <= 3; index += 1) {
    const body = new Uint8Array(3 + index);
    body[0] = 0x80;
    body[1] = 0x00;
    body[2] = 0x00;
    body.fill(0xc0 + index, 3);
    cases.push({
      id: `malformed-branch-trailing-${index}`,
      bytes: body,
      offset: 0,
      expectedKind: "MALFORMED_NODE",
      expectedMessage: new RegExp(`^branch node has ${index} trailing bytes$`),
      level: "node",
    });
  }

  return cases;
}

const negativeCases: NegativeCase[] = buildNegativeCases();

test("B: 200 negative compact and malformed-node cases", async (t) => {
  logSeed("compact/B");

  const seen = new Set<string>();
  const kinds = new Map<string, number>();

  for (const [index, entry] of negativeCases.entries()) {
    const hex = bytesToHex(entry.bytes);
    assert.ok(!seen.has(`${hex}@${entry.offset}`), `duplicate negative input ${hex}`);
    seen.add(`${hex}@${entry.offset}`);

    await t.test(
      `B#${String(index + 1).padStart(3, "0")} ${entry.id}`,
      () => {
        let thrown: TrieDecodeError | undefined;

        try {
          if (entry.level === "compact") {
            decodeCompactLength(entry.bytes, entry.offset);
          } else {
            decodeNode(entry.bytes);
          }
        } catch (error) {
          thrown = error instanceof TrieDecodeError ? error : undefined;
        }

        assert.ok(thrown instanceof TrieDecodeError, "must throw a TrieDecodeError");
        assert.equal(thrown.kind, entry.expectedKind);
        assert.match(thrown.message, entry.expectedMessage);
        kinds.set(thrown.kind, (kinds.get(thrown.kind) ?? 0) + 1);
      },
    );
  }

  assert.equal(negativeCases.length, 200);
  assert.equal(kinds.get("MALFORMED_NODE"), 200);
});
