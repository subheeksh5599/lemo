import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { digestOf, verifyPackage, type ProofPackage } from "../src/proofs/package.ts";
import { openProof } from "../src/trie/proof.ts";
import { bytes } from "../src/bytes.ts";
import type { TitleBinding } from "../src/titles/model.ts";

type Fixture = {
  capturedFrom: string;
  genesisHash: string;
  binding: TitleBinding;
  package: ProofPackage;
};

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/system-witness.json", import.meta.url), "utf8"),
) as Fixture;

function verify(pkg: unknown, minConfirmations = 0) {
  return verifyPackage({
    package: pkg,
    headNumber: fixture.package.block.number,
    minConfirmations,
    expectedGenesis: fixture.genesisHash,
  });
}

test("the captured package verifies against its own state root", () => {
  const report = verify(fixture.package);
  assert.equal(report.valid, true, JSON.stringify(report.checks));
  assert.equal(report.entries.every((entry) => entry.status === "present"), true);
});

test("the proof nodes reach the block state root and answer every declared key", () => {
  const opened = openProof(
    fixture.package.proof.map((node) => bytes.fromHex(node)),
    bytes.fromHex(fixture.package.block.stateRoot),
  );

  for (const key of fixture.package.keys) {
    assert.equal(opened.lookup(bytes.fromHex(key.key)).status, "present", `${key.label} was not answered`);
  }
});

test("a rewritten state root fails the digest and the proof together", () => {
  const tampered = {
    ...fixture.package,
    block: { ...fixture.package.block, stateRoot: `0x${"99".repeat(32)}` },
  };

  const report = verify(tampered);
  assert.equal(report.valid, false);
  const digest = report.checks.find((check) => check.name === "digest");
  assert.equal(digest?.ok, false);
});

test("a forged digest does not rescue a broken node set", () => {
  const broken: ProofPackage = {
    ...fixture.package,
    proof: fixture.package.proof.map(() => `0x${"00".repeat(8)}`),
  };
  const resigned = withFreshDigest(broken);

  const report = verify(resigned);
  assert.equal(report.valid, false);
  assert.equal(report.checks.find((check) => check.name === "digest")?.ok, true);
  assert.equal(report.checks.find((check) => check.name === "state root")?.ok, false);
});

test("dropping a required node from the set is reported as missing coverage", () => {
  const shortened: ProofPackage = { ...fixture.package, proof: fixture.package.proof.slice(1) };
  const report = verify(withFreshDigest(shortened));

  assert.equal(report.valid, false);
  assert.ok(report.checks.some((check) => check.name === "state root" || check.name === "coverage"));
});

function withFreshDigest(pkg: ProofPackage): ProofPackage {
  const { digest: _digest, builtAt: _builtAt, ...body } = pkg;
  return { ...pkg, digest: digestOf(body) };
}

test("a package from before the required depth is rejected as stale", () => {
  const report = verify(fixture.package, fixture.package.block.number + 1);
  const finality = report.checks.find((check) => check.name === "finality");
  assert.equal(finality?.ok, false);
  assert.equal(report.valid, false);
});

test("a package claiming a future block is refused", () => {
  const ahead: ProofPackage = { ...fixture.package, block: { ...fixture.package.block, number: fixture.package.block.number + 5 } };
  const report = verifyPackage({ package: ahead, headNumber: fixture.package.block.number, minConfirmations: 0 });
  const finality = report.checks.find((check) => check.name === "finality");
  assert.equal(finality?.ok, false);
  assert.equal(report.valid, false);
});

test("a package bound to another chain is refused", () => {
  const report = verifyPackage({
    package: fixture.package,
    headNumber: fixture.package.block.number,
    minConfirmations: 0,
    expectedGenesis: `0x${"77".repeat(32)}`,
  });
  assert.equal(report.valid, false);
});

test("the digest is a function of content only", () => {
  const body = {
    version: fixture.package.version,
    titleId: fixture.package.titleId,
    chain: fixture.package.chain,
    block: fixture.package.block,
    keys: fixture.package.keys,
    proof: fixture.package.proof,
  };
  assert.equal(digestOf(body), digestOf(body));
  assert.equal(digestOf(body), fixture.package.digest);
});
