import test from "node:test";
import assert from "node:assert/strict";
import { bytesToHex, hexToBytes } from "../src/util/bytes.ts";
import {
  applyHasher,
  mapStorageKey,
  palletItemKey,
  SYSTEM_ACCOUNT_PREFIX,
  SYSTEM_NUMBER_KEY,
  twox128,
} from "../src/proofs/keys.ts";
import { loadFixture } from "./helpers/fixture.ts";

const fixture = loadFixture();

test("twox128 matches the reference vectors", () => {
  assert.equal(bytesToHex(twox128("System")), "0x26aa394eea5630e07c48ae0c9558cef7");
  assert.equal(bytesToHex(twox128("Account")), "0xb99d880ec681799c0cf30e8886371da9");
});

test("a pallet item key is twox128(pallet) then twox128(item)", () => {
  assert.equal(
    SYSTEM_NUMBER_KEY,
    "0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac",
  );
  assert.equal(palletItemKey("System", "Number"), SYSTEM_NUMBER_KEY);
  assert.equal(
    SYSTEM_ACCOUNT_PREFIX,
    "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9",
  );
});

test("the captured System.Account key is reproduced from its map hasher", () => {
  const key = fixture.proofs.systemAccount.key;
  const body = key.slice(2);

  // 16 bytes pallet prefix, 16 bytes item prefix, 16 bytes blake2-128, 32-byte account.
  assert.equal(body.length, 160);
  assert.equal(body.slice(0, 64), SYSTEM_ACCOUNT_PREFIX.slice(2));

  const accountId = `0x${body.slice(96)}` as const;
  const rebuilt = mapStorageKey({
    pallet: "System",
    item: "Account",
    hasher: "Blake2_128Concat",
    key: accountId,
  });

  assert.equal(rebuilt, key);
});

test("Blake2_128 and Blake2_128Concat are different layouts", () => {
  const key = hexToBytes("0x00112233445566778899aabbccddeeff");
  const bare = applyHasher("Blake2_128", key);
  const concat = applyHasher("Blake2_128Concat", key);

  assert.equal(bare.length, 16);
  assert.equal(concat.length, 16 + key.length);
  assert.equal(bytesToHex(concat.slice(0, 16)), bytesToHex(bare));
  assert.equal(bytesToHex(concat.slice(16)), bytesToHex(key));
});

test("the other documented hashers produce their documented widths", () => {
  const key = hexToBytes("0x0102");

  assert.equal(applyHasher("Identity", key).length, 2);
  assert.equal(applyHasher("Blake2_256", key).length, 32);
  assert.equal(applyHasher("Twox64", key).length, 8);
  assert.equal(applyHasher("Twox64Concat", key).length, 10);
  assert.equal(applyHasher("Twox128", key).length, 16);
  assert.equal(applyHasher("Twox256", key).length, 32);
});
