import test from "node:test";
import assert from "node:assert/strict";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { verifyStorageProof } from "../../src/proofs/trie.ts";
import { bytesToHex, hexToBytes, type Hex } from "../../src/util/bytes.ts";
import { loadFixture, type FixtureProof } from "../helpers/fixture.ts";
import { flipByte, logSeed, randomInt, seeded } from "./support.ts";

/**
 * Stress part D: mutation of the real, live-captured Portaldot V3 proof set.
 *
 * Each case flips exactly one byte in exactly one proof node and runs the real
 * verifier with the fixture's own storage as the claim. The invariant is the
 * one Rule 2 depends on:
 *
 *   a tampered proof may be refused or may prove absence, but it may never
 *   report `present` with a value that differs from the fixture storage.
 *
 * Outcomes are categorized and counted, including the honest case where the
 * flipped node is not consumed by the walk (so the proof still verifies). Those
 * cases are counted, not hidden.
 */

logSeed("mutation");

const fixture = loadFixture();

type Target = {
  readonly name: string;
  readonly proof: FixtureProof;
  readonly claim: Hex | null;
  readonly storage: Hex | null;
};

const targets: readonly Target[] = [
  {
    name: "systemNumber",
    proof: fixture.proofs.systemNumber,
    claim: fixture.proofs.systemNumber.storage,
    storage: fixture.proofs.systemNumber.storage,
  },
  {
    name: "systemAccount",
    proof: fixture.proofs.systemAccount,
    claim: fixture.proofs.systemAccount.storage,
    storage: fixture.proofs.systemAccount.storage,
  },
  {
    name: "absentKey",
    proof: fixture.proofs.absentKey,
    claim: null,
    storage: null,
  },
];

/** Hashes of the nodes the untampered walk actually consumed. */
function baseline(): readonly { readonly status: string; readonly walked: ReadonlySet<string> }[] {
  return targets.map((target) => {
    const result = verifyStorageProof({
      proof: target.proof.proof,
      rootHash: fixture.block.stateRoot,
      key: target.proof.key,
      expectedValue: target.claim,
    });

    if (target.storage === null) {
      assert.equal(result.status, "absent");
    } else {
      assert.equal(result.status, "present");
      assert.equal(result.value, target.storage);
    }

    return { status: result.status, walked: new Set(result.steps.map((step) => step.node)) };
  });
}

const base = baseline();

type Mutation = {
  readonly targetIndex: number;
  readonly nodeIndex: number;
  readonly byteIndex: number;
};

function nodeLength(hex: Hex): number {
  return (hex.length - 2) / 2;
}

function buildMutations(): Mutation[] {
  const rand = seeded(4);
  const chosen: Mutation[] = [];
  const seen = new Set<string>();
  let guard = 0;

  while (chosen.length < 200 && guard < 200_000) {
    guard += 1;
    const targetIndex = randomInt(rand, 0, targets.length - 1);
    const proof = targets[targetIndex]?.proof;

    if (proof === undefined) {
      continue;
    }

    const nodeIndex = randomInt(rand, 0, proof.proof.length - 1);
    const node = proof.proof[nodeIndex];

    if (node === undefined) {
      continue;
    }

    const byteIndex = randomInt(rand, 0, nodeLength(node) - 1);
    const key = `${targetIndex}:${nodeIndex}:${byteIndex}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    chosen.push({ targetIndex, nodeIndex, byteIndex });
  }

  assert.equal(chosen.length, 200, "the fixture must offer 200 distinct node/byte mutations");
  return chosen;
}

const mutations = buildMutations();

test("D: 200 single-byte mutations of the live proof never yield a changed value", async (t) => {
  logSeed("mutation/D");

  const outcomes = new Map<string, number>();
  let presentCount = 0;
  let walkedCount = 0;
  let offWalkCount = 0;
  const presentSamples: string[] = [];

  for (const [index, mutation] of mutations.entries()) {
    const target = targets[mutation.targetIndex];

    if (target === undefined) {
      throw new Error("unreachable mutation target");
    }

    const original = target.proof.proof[mutation.nodeIndex];

    if (original === undefined) {
      throw new Error("unreachable node index");
    }

    const originalHash = bytesToHex(blake2AsU8a(hexToBytes(original), 256));
    const mutated = bytesToHex(flipByte(hexToBytes(original), mutation.byteIndex));
    const wasWalked = base[mutation.targetIndex]?.walked.has(originalHash) ?? false;

    if (wasWalked) {
      walkedCount += 1;
    } else {
      offWalkCount += 1;
    }

    const proof: Hex[] = target.proof.proof.map((node, nodeIndex) =>
      nodeIndex === mutation.nodeIndex ? mutated : node,
    );

    await t.test(
      `D#${String(index + 1).padStart(3, "0")} ${target.name} node[${mutation.nodeIndex}] byte[${mutation.byteIndex}] ${wasWalked ? "on-walk" : "off-walk"}`,
      () => {
        assert.notEqual(mutated, original, "the mutation must actually change the node");

        const result = verifyStorageProof({
          proof,
          rootHash: fixture.block.stateRoot,
          key: target.proof.key,
          expectedValue: target.claim,
        });

        // The fail-open invariant: `present` may only ever carry the value the
        // live node returned. A different value here is a production bug.
        if (result.status === "present") {
          assert.equal(
            result.value,
            target.storage,
            "present must never carry a value different from the fixture storage",
          );
          assert.notEqual(target.storage, null, "an absent key must never verify as present");
          assert.equal(
            wasWalked,
            false,
            "a byte flipped inside a walked node must never still verify as present",
          );
          presentCount += 1;

          if (presentSamples.length < 3) {
            presentSamples.push(
              `${target.name} node[${mutation.nodeIndex}] byte[${mutation.byteIndex}]`,
            );
          }
        }

        assert.ok(
          ["present", "absent", "invalid", "incomplete", "mismatch"].includes(result.status),
          `unexpected status ${result.status}`,
        );

        const category = result.error === null ? result.status : `${result.status}/${result.error.kind}`;
        outcomes.set(category, (outcomes.get(category) ?? 0) + 1);

        if (target.storage === null) {
          assert.notEqual(result.status, "present");
        }
      },
    );
  }

  const total = [...outcomes.values()].reduce((sum, count) => sum + count, 0);
  assert.equal(total, 200, "every mutation must land in exactly one outcome category");

  const sorted = [...outcomes.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.log(
    `[stress] D mutation outcomes (200 cases, ${offWalkCount} flipped nodes off the baseline walk, ${walkedCount} on it):`,
  );

  for (const [category, count] of sorted) {
    console.log(`[stress]   ${category}: ${count}`);
  }

  console.log(
    `[stress]   present-with-fixture-value: ${presentCount} (off-walk only; 0 changed values)`,
  );

  if (presentSamples.length > 0) {
    console.log(`[stress]   present samples: ${presentSamples.join(", ")}`);
  }

  assert.equal(presentCount <= offWalkCount, true, "present cannot outnumber off-walk mutations");
  assert.equal(outcomes.get("present/VALUE_MISMATCH") ?? 0, 0);
});

/**
 * None of the 15 nodes the live capture supplies is unused: every one is either
 * on the walk or resolved as a hashed value. So the 200 pure cases cannot hit
 * the "extra node in the response" branch. This probe appends a live node from
 * the same block that the target proof never references, flips one byte in it,
 * and shows the verifier still returns present with the fixture value. The
 * outcome is counted, not treated as a failure.
 */
test("D: 10 unused live nodes are counted as present, not hidden", async (t) => {
  const rand = seeded(6);
  const donorNodes = fixture.proofs.absentKey.proof;
  const presentTargets = targets.filter((target) => target.storage !== null);
  let accepted = 0;

  for (let index = 0; index < 10; index += 1) {
    const target = presentTargets[index % presentTargets.length];
    const donor = donorNodes[randomInt(rand, 0, donorNodes.length - 1)];

    if (target === undefined || donor === undefined) {
      throw new Error("unreachable unused-node probe");
    }

    const byteIndex = randomInt(rand, 0, nodeLength(donor) - 1);
    const mutated = bytesToHex(flipByte(hexToBytes(donor), byteIndex));

    await t.test(
      `D-unused#${String(index + 1).padStart(2, "0")} ${target.name} extra node byte[${byteIndex}]`,
      () => {
        const result = verifyStorageProof({
          proof: [...target.proof.proof, mutated],
          rootHash: fixture.block.stateRoot,
          key: target.proof.key,
          expectedValue: target.claim,
        });

        assert.equal(result.status, "present");
        assert.equal(result.value, target.storage);
        accepted += 1;
      },
    );
  }

  console.log(
    `[stress] D unused-node probes: ${accepted}/10 present with the fixture value (extra node counted, not hidden)`,
  );
});

