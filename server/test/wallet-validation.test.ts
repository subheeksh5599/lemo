import test from "node:test";
import assert from "node:assert/strict";
import {
  isEvmAddress,
  isValidSs58,
  isVerifiedRdns,
  mergeAnnouncement,
  normalizeSubstrateAccounts,
  parseEip6963Announcement,
  safeWalletIcon,
  type Eip1193Provider,
} from "../../lib/wallet/validation.ts";

/**
 * M-09 / L-08: the browser wallet layer's input validation. The module is
 * DOM-free so it is exercised here under the server's node:test runner.
 */

const ALICE_42 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
/** The same public key encoded for Polkadot (prefix 0). */
const ALICE_0 = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E";
const WEBP = "data:image/webp;base64,UklGRg==";

function provider(): Eip1193Provider {
  return { request: async () => null };
}

function announce(info: Record<string, unknown>, p: Eip1193Provider = provider()) {
  return parseEip6963Announcement({ info, provider: p });
}

test("wallet icons: only inline png/svg/webp data URIs are allowed", () => {
  assert.equal(safeWalletIcon(PNG), PNG);
  assert.equal(safeWalletIcon(SVG), SVG);
  assert.equal(safeWalletIcon(WEBP), WEBP);
  assert.equal(safeWalletIcon("DATA:IMAGE/PNG;base64,AAAA"), "DATA:IMAGE/PNG;base64,AAAA");

  for (const bad of [
    "https://tracker.example/pixel.png",
    "//tracker.example/p.svg",
    "http://localhost/icon.png",
    "javascript:alert(1)",
    "data:text/html;base64,PGgxPg==",
    "data:image/gif;base64,R0lGOD==",
    "data:image/jpeg;base64,/9j/",
    "data:image/svg+xml",
    " data:image/png",
    "",
    null,
    42,
    `data:image/png;base64,${"A".repeat(128 * 1024)}`,
  ]) {
    assert.equal(safeWalletIcon(bad), null, String(bad).slice(0, 40));
  }
});

test("EIP-6963: only pinned rdns are verified; spoofed metadata is unverified", () => {
  assert.equal(isVerifiedRdns("io.metamask"), true);
  assert.equal(isVerifiedRdns("io.rabby"), true);
  assert.equal(isVerifiedRdns("com.coinbase.wallet"), true);
  assert.equal(isVerifiedRdns("app.subwallet"), true);
  assert.equal(isVerifiedRdns("io.talisman"), true);
  assert.equal(isVerifiedRdns("io.metamask.evil"), false);
  assert.equal(isVerifiedRdns("IO.METAMASK"), false);
  assert.equal(isVerifiedRdns(undefined), false);

  const real = announce({ name: "MetaMask", rdns: "io.metamask", uuid: "u1", icon: PNG });
  assert.ok(real);
  assert.equal(real.verified, true);
  assert.equal(real.icon, PNG);

  const lookalike = announce({
    name: "MetaMask",
    rdns: "io.metamask-wallet",
    uuid: "u2",
    icon: "https://tracker.example/mm.png",
  });
  assert.ok(lookalike);
  assert.equal(lookalike.verified, false);
  assert.equal(lookalike.icon, null);

  const noRdns = announce({ name: "Mystery", uuid: "u3" });
  assert.equal(noRdns?.verified, false);
  assert.equal(noRdns?.id, "u3");

  const badRdns = announce({ name: "X", rdns: "not an rdns", uuid: "u4" });
  assert.equal(badRdns?.rdns, "");
  assert.equal(badRdns?.verified, false);

  const bidi = announce({ name: "\u202eksaMateM\u0000", rdns: "x.y", uuid: "u5" });
  assert.equal(bidi?.name, "ksaMateM");

  assert.equal(announce({ name: "", rdns: "io.metamask" }), null);
  assert.equal(announce({ name: "\u0000\u202e", rdns: "io.metamask" }), null);
  assert.equal(announce({ name: "NoId" }), null);
  assert.equal(parseEip6963Announcement({ info: { name: "x", rdns: "a.b" }, provider: {} }), null);
  assert.equal(parseEip6963Announcement(null), null);
});

test("EIP-6963: a second provider claiming a verified rdns demotes it", () => {
  const first = announce({ name: "MetaMask", rdns: "io.metamask", uuid: "a" });
  const spoof = announce({ name: "MetaMask", rdns: "io.metamask", uuid: "b" });
  assert.ok(first && spoof);

  const initial = mergeAnnouncement(undefined, first);
  assert.equal(initial.changed, true);
  assert.equal(initial.wallet, first);

  const repeat = mergeAnnouncement(first, { ...first, uuid: "a2" });
  assert.equal(repeat.changed, false);
  assert.equal(repeat.wallet, first);

  const clash = mergeAnnouncement(first, spoof);
  assert.equal(clash.changed, true);
  assert.equal(clash.wallet.verified, false);
  assert.equal(clash.wallet.provider, first.provider, "first claimant keeps the id");

  const again = mergeAnnouncement(clash.wallet, spoof);
  assert.equal(again.changed, false);
});

test("SS58: only checksum-valid prefix-42 addresses are accepted", () => {
  assert.equal(isValidSs58(ALICE_42), true);
  assert.notEqual(ALICE_0, ALICE_42);
  assert.equal(isValidSs58(ALICE_0), false, "polkadot prefix 0 is refused");
  assert.equal(isValidSs58(ALICE_0, 0), true);

  const flipped = `${ALICE_42.slice(0, -1)}${ALICE_42.endsWith("Y") ? "Z" : "Y"}`;
  assert.equal(isValidSs58(flipped), false, "bad checksum");
  assert.equal(isValidSs58(`0x${"d4".repeat(32)}`), false, "hex public key");
  assert.equal(isValidSs58("0x0000000000000000000000000000000000000000"), false);
  assert.equal(isValidSs58("not-an-address"), false);
  assert.equal(isValidSs58(""), false);
  assert.equal(isValidSs58(null), false);
  assert.equal(isValidSs58("5".repeat(65)), false);
});

test("Substrate accounts: invalid addresses are dropped, valid ones kept once", () => {
  const accounts = normalizeSubstrateAccounts([
    { address: ALICE_42, name: "Alice", type: "sr25519", genesisHash: null },
    { address: ALICE_42, name: "dup" },
    { address: ALICE_0, name: "wrong prefix" },
    { address: "5FakeAddress", name: "garbage" },
    { address: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d" },
    { name: "no address" },
    "string",
    null,
  ]);

  assert.deepEqual(accounts, [
    { address: ALICE_42, name: "Alice", type: "sr25519", genesisHash: null },
  ]);
  assert.deepEqual(normalizeSubstrateAccounts("nope"), []);
});

test("EVM accounts must be 20-byte hex", () => {
  assert.equal(isEvmAddress("0x52908400098527886E0F7030069857D2E4169EE7"), true);
  assert.equal(isEvmAddress("0x123"), false);
  assert.equal(isEvmAddress("<img src=x>"), false);
  assert.equal(isEvmAddress(1), false);
});
