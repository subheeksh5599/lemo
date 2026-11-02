import test from "node:test";
import assert from "node:assert/strict";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { bytesToHex, hexToBytes, type Hex } from "../../src/util/bytes.ts";
import {
  mapStorageKey,
  palletItemKey,
  SYSTEM_ACCOUNT_PREFIX,
  SYSTEM_NUMBER_KEY,
  twox128,
} from "../../src/proofs/keys.ts";
import { loadFixture } from "../helpers/fixture.ts";
import { logSeed, randomInt, seeded } from "./support.ts";

/**
 * Stress part E: storage-key derivation.
 *
 * A pallet item lives at twox128(pallet) ++ twox128(item). twox128 is xxhash64
 * with seeds 0..3, not blake2-128. Getting this wrong reads null from a chain
 * that answered a perfectly valid non-inclusion proof, so the suite pins the
 * live System.Number vector, the 16-byte prefix widths, and the uniqueness of
 * independently generated pallet/item pairs.
 */

logSeed("keys");

const fixture = loadFixture();

const FIXED_CHECKS: readonly { readonly name: string; readonly run: () => void }[] = [
  {
    name: "System.Number key is the live vector",
    run: () => {
      assert.equal(
        SYSTEM_NUMBER_KEY,
        "0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac",
      );
    },
  },
  {
    name: "twox128(System) is the reference prefix",
    run: () => {
      assert.equal(bytesToHex(twox128("System")), "0x26aa394eea5630e07c48ae0c9558cef7");
    },
  },
  {
    name: "twox128(Number) is the reference prefix",
    run: () => {
      assert.equal(bytesToHex(twox128("Number")), "0x02a5c1b19ab7a04f536c519aca4983ac");
    },
  },
  {
    name: "twox128(System) is 16 bytes",
    run: () => {
      assert.equal(twox128("System").length, 16);
      assert.equal(bytesToHex(twox128("System")).length, 34);
    },
  },
  {
    name: "twox128(Number) is 16 bytes",
    run: () => {
      assert.equal(twox128("Number").length, 16);
      assert.equal(bytesToHex(twox128("Number")).length, 34);
    },
  },
  {
    name: "a pallet item key is 32 bytes, prefix then item",
    run: () => {
      assert.equal(SYSTEM_NUMBER_KEY.length, 66);
      assert.equal(SYSTEM_NUMBER_KEY.slice(0, 34), bytesToHex(twox128("System")));
      assert.equal(SYSTEM_NUMBER_KEY.slice(34), bytesToHex(twox128("Number")).slice(2));
    },
  },
  {
    name: "System.Account prefix is the documented vector",
    run: () => {
      assert.equal(
        SYSTEM_ACCOUNT_PREFIX,
        "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9",
      );
    },
  },
  {
    name: "System.Account prefix is 32 bytes",
    run: () => {
      assert.equal(SYSTEM_ACCOUNT_PREFIX.length, 66);
    },
  },
  {
    name: "palletItemKey is deterministic",
    run: () => {
      assert.equal(palletItemKey("System", "Number"), palletItemKey("System", "Number"));
    },
  },
  {
    name: "palletItemKey agrees with the constant",
    run: () => {
      assert.equal(palletItemKey("System", "Number"), SYSTEM_NUMBER_KEY);
      assert.equal(palletItemKey("System", "Account"), SYSTEM_ACCOUNT_PREFIX);
    },
  },
  {
    name: "pallet order matters",
    run: () => {
      assert.notEqual(palletItemKey("System", "Number"), palletItemKey("Number", "System"));
    },
  },
  {
    name: "System and Number prefixes differ",
    run: () => {
      assert.notEqual(bytesToHex(twox128("System")), bytesToHex(twox128("Number")));
    },
  },
  {
    name: "twox128 accepts a Uint8Array and matches the string form",
    run: () => {
      assert.deepEqual(twox128(new TextEncoder().encode("System")), twox128("System"));
    },
  },
  {
    name: "an empty pallet name still hashes to 16 bytes",
    run: () => {
      assert.equal(twox128("").length, 16);
      assert.equal(palletItemKey("", "").length, 66);
    },
  },
  {
    name: "twox128 is not blake2-128",
    run: () => {
      assert.notEqual(bytesToHex(twox128("System")), bytesToHex(blake2AsU8a("System", 128)));
    },
  },
  {
    name: "the live System.Account key is reproduced by Blake2_128Concat",
    run: () => {
      const key = fixture.proofs.systemAccount.key;
      const body = key.slice(2);
      assert.equal(body.length, 160, "16 + 16 prefix, 16 hash, 32 account id");
      assert.equal(body.slice(0, 64), SYSTEM_ACCOUNT_PREFIX.slice(2));
      const accountId = `0x${body.slice(96)}` as Hex;
      const rebuilt = mapStorageKey({
        pallet: "System",
        item: "Account",
        hasher: "Blake2_128Concat",
        key: accountId,
      });
      assert.equal(rebuilt, key);
    },
  },
  {
    name: "the map key is prefix + 16-byte hash + the 32-byte key",
    run: () => {
      const key = fixture.proofs.systemAccount.key;
      assert.equal((key.length - 2) / 2, 16 + 16 + 48);
    },
  },
  {
    name: "the System.Number proof key is the derived key",
    run: () => {
      assert.equal(fixture.proofs.systemNumber.key, SYSTEM_NUMBER_KEY);
    },
  },
  {
    name: "twox128 output is a fresh Uint8Array each call",
    run: () => {
      assert.notEqual(twox128("System").buffer, twox128("System").buffer);
    },
  },
  {
    name: "hex round-trip of the System.Number key is exact",
    run: () => {
      assert.equal(bytesToHex(hexToBytes(SYSTEM_NUMBER_KEY)), SYSTEM_NUMBER_KEY);
    },
  },
];

type Pair = { readonly pallet: string; readonly item: string };

function buildPairs(): Pair[] {
  const rand = seeded(5);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789_";
  const seen = new Set<string>();
  const pairs: Pair[] = [];

  const word = (): string => {
    const length = randomInt(rand, 3, 14);
    let out = "";

    for (let index = 0; index < length; index += 1) {
      out += alphabet[randomInt(rand, 0, alphabet.length - 1)];
    }

    return out;
  };

  while (pairs.length < 80) {
    const pallet = `${word().toUpperCase()}${word()}`;
    const item = word();
    const id = `${pallet}\u0000${item}`;

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    pairs.push({ pallet, item });
  }

  return pairs;
}

const pairs = buildPairs();
const generatedKeys: Hex[] = [];

test("E: 100 storage-key derivation checks", async (t) => {
  logSeed("keys/E");

  for (const [index, check] of FIXED_CHECKS.entries()) {
    await t.test(`E#${String(index + 1).padStart(3, "0")} fixed ${check.name}`, check.run);
  }

  for (const [index, pair] of pairs.entries()) {
    await t.test(
      `E#${String(FIXED_CHECKS.length + index + 1).padStart(3, "0")} pair ${pair.pallet}/${pair.item}`,
      () => {
        const palletPrefix = twox128(pair.pallet);
        const itemPrefix = twox128(pair.item);
        const key = palletItemKey(pair.pallet, pair.item);

        assert.equal(palletPrefix.length, 16, "pallet prefix must be 16 bytes");
        assert.equal(itemPrefix.length, 16, "item prefix must be 16 bytes");
        assert.equal(key.length, 66, "a pallet item key is 32 bytes of hex");
        assert.equal(key.slice(0, 34), bytesToHex(palletPrefix));
        assert.equal(key.slice(34), bytesToHex(itemPrefix).slice(2));
        assert.equal(key, bytesToHex(concat(palletPrefix, itemPrefix)));
        assert.notEqual(key, SYSTEM_NUMBER_KEY);

        generatedKeys.push(key);
      },
    );
  }

  await t.test("E#101 all 80 generated pallet/item pairs produce distinct keys", () => {
    assert.equal(generatedKeys.length, 80);

    const unique = new Set(generatedKeys);
    assert.equal(unique.size, 80, "two distinct pallet/item pairs produced the same key");
    assert.equal(unique.has(SYSTEM_NUMBER_KEY), false);
  });
});

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}
