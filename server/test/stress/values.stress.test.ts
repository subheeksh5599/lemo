import test from "node:test";
import assert from "node:assert/strict";
import { bytesToHex, type Hex } from "../../src/util/bytes.ts";
import { blockNumberAgrees, decodeStorageValue } from "../../src/proofs/values.ts";
import { SYSTEM_NUMBER_KEY } from "../../src/proofs/keys.ts";
import { loadFixture } from "../helpers/fixture.ts";
import { logSeed, randomInt, randomU32, seeded, u32leHex } from "./support.ts";

/**
 * Stress part C: System.Number is a plain little-endian u32, so the typed
 * decoder must round-trip every u32 and must refuse every other width with a
 * null value plus a note. A wrong-width blob that decodes to a plausible
 * number is exactly the failure that makes a proof service report the wrong
 * block.
 */

logSeed("values");

const fixture = loadFixture();
const fixtureNumber = decodeStorageValue(SYSTEM_NUMBER_KEY, fixture.proofs.systemNumber.storage as Hex);

type ValueCase =
  | { readonly kind: "roundtrip"; readonly id: string; readonly value: number }
  | { readonly kind: "wrong-width"; readonly id: string; readonly raw: Hex; readonly width: number };

function buildValueCases(): ValueCase[] {
  const rand = seeded(3);
  const cases: ValueCase[] = [];
  const used = new Set<number>();

  const roundtrip = (value: number): void => {
    cases.push({ kind: "roundtrip", id: `value=${value}`, value });
    used.add(value);
  };

  for (const value of [0, 1, 292_815, 292_863, 0xffff_ffff, 0xffff_fffe]) {
    roundtrip(value);
  }

  while (cases.length < 160) {
    const value = randomU32(rand);

    if (used.has(value)) {
      continue;
    }

    roundtrip(value);
  }

  const widths = [0, 1, 2, 3, 5, 6, 7, 8, 9, 16, 31, 32, 33, 64];
  const wrongWidth = new Set<number>();

  for (const width of widths) {
    const raw = bytesToHex(new Uint8Array(width).fill(0xff));
    cases.push({ kind: "wrong-width", id: `width=${width}`, raw, width });
    wrongWidth.add(width);
  }

  while (wrongWidth.size < 40) {
    const width = randomInt(rand, 0, 40);

    if (width === 4 || wrongWidth.has(width)) {
      continue;
    }

    const raw = bytesToHex(new Uint8Array(width).fill(0xff));
    cases.push({ kind: "wrong-width", id: `width=${width}`, raw, width });
    wrongWidth.add(width);
  }

  return cases;
}

const valueCases = buildValueCases();

test("C: 200 storage-value u32 cases", async (t) => {
  logSeed("values/C");

  assert.equal(valueCases.length, 200);

  for (const [index, entry] of valueCases.entries()) {
    const prefix = `C#${String(index + 1).padStart(3, "0")}`;

    if (entry.kind === "roundtrip") {
      await t.test(`${prefix} u32 ${entry.id}`, () => {
        const raw = u32leHex(entry.value);
        assert.equal(raw.length, 10, "u32 encoding is exactly 4 bytes");
        assert.equal(raw, entry.value === 0 ? "0x00000000" : raw);

        const decoded = decodeStorageValue(SYSTEM_NUMBER_KEY, raw);

        assert.equal(decoded.label, "System.Number");
        assert.equal(decoded.encoding, "u32-le");
        assert.equal(decoded.value, entry.value, "decoded number must equal the encoded u32");
        assert.equal(decoded.note, null, "a 4-byte value decodes without a note");
        assert.equal(blockNumberAgrees(decoded, entry.value), true);
        assert.equal(blockNumberAgrees(decoded, (entry.value + 1) % 0x1_0000_0000), false);
      });
    } else {
      await t.test(`${prefix} wrong width ${entry.id}`, () => {
        const decoded = decodeStorageValue(SYSTEM_NUMBER_KEY, entry.raw);

        assert.equal(decoded.label, "System.Number");
        assert.equal(decoded.encoding, "u32-le");
        assert.equal(decoded.value, null, "a non-4-byte blob must not yield a number");
        assert.equal(
          decoded.note,
          `expected 4 bytes for System.Number, got ${entry.width}`,
          "the length mismatch must be reported, not dropped",
        );
        assert.equal(blockNumberAgrees(decoded, fixture.block.number), false);
      });
    }
  }
});

test("C: the captured fixture decodes to the block the node returned", () => {
  assert.equal(fixtureNumber.label, "System.Number");
  assert.equal(fixtureNumber.encoding, "u32-le");
  assert.equal(fixtureNumber.note, null);
  assert.equal(fixtureNumber.value, fixture.block.number);
  assert.equal(blockNumberAgrees(fixtureNumber, fixture.block.number), true);
  assert.equal(
    fixture.proofs.systemNumber.storage,
    u32leHex(fixture.block.number),
    "the fixture storage must be the little-endian u32 of the fixture block number",
  );
});
