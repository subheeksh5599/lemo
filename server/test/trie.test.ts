import test from "node:test";
import assert from "node:assert/strict";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { bytesToHex, hexToBytes, readUintLE, type Hex } from "../src/util/bytes.ts";
import {
  classifyHeader,
  decodeCompactLength,
  decodeNode,
  verifyStorageProof,
  type DecodedNode,
} from "../src/proofs/trie.ts";
import { decodeStorageValue } from "../src/proofs/values.ts";
import {
  findNodeForHash,
  loadFixture,
  tamperHex,
  tamperNodesForHash,
} from "./helpers/fixture.ts";

const fixture = loadFixture();
const numberProof = fixture.proofs.systemNumber;
const accountProof = fixture.proofs.systemAccount;
const absentProof = fixture.proofs.absentKey;

function u8(hex: string): Uint8Array {
  return hexToBytes(hex as `0x${string}`);
}

function partialOf(node: DecodedNode): readonly number[] {
  return node.partial;
}

/**
 * Proof nodes arrive in no guaranteed order, so every test that targets a
 * particular node finds it by its hash rather than by its index.
 */
function nodeForHash(proof: readonly Hex[], hash: string): Hex {
  const found = findNodeForHash(proof, hash);

  if (found === undefined) {
    throw new Error(`no node hashes to ${hash}`);
  }

  return found;
}

/* ------------------------------------------------------- compact decoding */

test("compact lengths decode in all three inline modes", () => {
  assert.deepEqual(decodeCompactLength(u8("0x08"), 0), { value: 2, next: 1 });
  assert.deepEqual(decodeCompactLength(u8("0xfc"), 0), { value: 63, next: 1 });
  // 80 is the size of a System.Account record: the two-byte form, live.
  assert.deepEqual(decodeCompactLength(u8("0x4101"), 0), { value: 80, next: 2 });
  assert.deepEqual(decodeCompactLength(u8("0x02010000"), 0), { value: 64, next: 4 });
  assert.deepEqual(decodeCompactLength(u8("0x06000000"), 0), { value: 1, next: 4 });
});

test("compact decoding refuses truncated and big-integer forms", () => {
  assert.throws(() => decodeCompactLength(u8("0x"), 0), /truncated compact length/);
  assert.throws(() => decodeCompactLength(u8("0x41"), 0), /truncated two-byte compact length/);
  assert.throws(() => decodeCompactLength(u8("0x03000000"), 0), /big-integer/);
});

/* --------------------------------------------------------- header kinds */

test("header kind bits are 6-7, so a state root is a branch and never a leaf", () => {
  assert.equal(classifyHeader(0x00), null);
  assert.equal(classifyHeader(0x40)?.kind, "leaf");
  assert.equal(classifyHeader(0x7f)?.kind, "leaf");
  // The exact bug this file replaced: `header & 0x80` called this a leaf.
  assert.equal(classifyHeader(0x80)?.kind, "branch");
  assert.equal(classifyHeader(0xbf)?.kind, "branch");
  assert.equal(classifyHeader(0xc0)?.kind, "branchWithValue");
  assert.equal(classifyHeader(0xff)?.kind, "branchWithValue");
  assert.equal(classifyHeader(0x20)?.kind, "hashedLeaf");
  assert.equal(classifyHeader(0x3f)?.kind, "hashedLeaf");
  assert.equal(classifyHeader(0x10)?.kind, "hashedBranchWithValue");
  assert.equal(classifyHeader(0x1f)?.kind, "hashedBranchWithValue");
});

test("the fixture's state root decodes as a branch with a short partial key", () => {
  const root = fixture.block.stateRoot;
  const rootNode = numberProof.proof.find(
    (node) => bytesToHex(blake2AsU8a(u8(node), 256)) === root.toLowerCase(),
  );
  assert.ok(rootNode, "the proof must contain the node hashing to the state root");

  const decoded = decodeNode(u8(rootNode));
  assert.equal(decoded.kind, "branch");
  assert.ok(partialOf(decoded).length <= 8, "a state root has a very short partial key");
});

/* ------------------------------------------------------------- decoding */

test("empty node decodes as empty and rejects trailing bytes", () => {
  assert.equal(decodeNode(u8("0x00")).kind, "empty");
  assert.throws(() => decodeNode(u8("0x0000")), /trailing bytes/);
});

test("leaf with an inline value decodes its partial key and value", () => {
  // header 0x40: leaf, partial length 0, then compact(2) and two value bytes.
  const node = decodeNode(u8("0x4008aabb"));
  assert.equal(node.kind, "leaf");
  assert.deepEqual(node.partial, []);
  assert.equal(node.kind === "leaf" && node.value.kind, "inline");

  if (node.kind === "leaf" && node.value.kind === "inline") {
    assert.equal(bytesToHex(node.value.bytes), "0xaabb");
  }
});

test("odd partial keys drop a zero pad nibble from the front", () => {
  // header 0x41: leaf with a 1-nibble partial; 0x05 = pad 0 then nibble 5.
  const node = decodeNode(u8("0x410504ff"));
  assert.deepEqual(node.partial, [5]);
  assert.throws(() => decodeNode(u8("0x411504ff")), /pad nibble/);
});

test("branch nodes decode the little-endian bitmap and their children", () => {
  // header 0x80: branch, no partial, bitmap 0x0004 (nibble 2), one inline child.
  const node = decodeNode(u8("0x8004000400"));
  assert.equal(node.kind, "branch");

  if (node.kind === "branch") {
    assert.deepEqual([...node.children.keys()], [2]);
    const child = node.children.get(2);
    assert.equal(child?.kind, "inline");
    assert.equal(node.value, null);
  }
});

test("branch-with-value decodes its value after the bitmap", () => {
  // header 0xc0, no partial, empty bitmap, value compact(1) 0x09.
  const node = decodeNode(u8("0xc000000409"));
  assert.equal(node.kind, "branch");

  if (node.kind === "branch") {
    assert.equal(node.children.size, 0);
    assert.equal(node.value?.kind, "inline");

    if (node.value?.kind === "inline") {
      assert.equal(bytesToHex(node.value.bytes), "0x09");
    }
  }
});

test("hashed value kinds carry a 32-byte reference, not the value", () => {
  const hash = `${"0x"}${"11".repeat(32)}` as `0x${string}`;
  const leaf = decodeNode(u8(`0x20${hash.slice(2)}`));

  assert.equal(leaf.kind, "leaf");

  if (leaf.kind === "leaf") {
    assert.equal(leaf.value.kind, "hashed");
  }

  const branch = decodeNode(u8(`0x100000${hash.slice(2)}`));
  assert.equal(branch.kind, "branch");

  if (branch.kind === "branch") {
    assert.equal(branch.value?.kind, "hashed");
  }

  assert.throws(() => decodeNode(u8("0x20112233")), /hashed value reference is truncated/);
});

test("a long partial key uses the continuation byte", () => {
  const result = verifyStorageProof({
    proof: accountProof.proof,
    rootHash: fixture.block.stateRoot,
    key: accountProof.key,
  });
  const leafStep = result.steps[result.steps.length - 1];

  assert.ok(leafStep);
  assert.equal(leafStep.kind, "hashedLeaf");

  const leaf = decodeNode(u8(nodeForHash(accountProof.proof, leafStep.node)));
  assert.equal(leaf.kind, "leaf");
  assert.equal(partialOf(leaf).length, 93);
});

/* ------------------------------------------- real proof, offline fixture */

test("the live System.Number proof reproduces the value the node returned", () => {
  const result = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
  });

  assert.equal(result.status, "present");
  assert.equal(result.rootMatches, true);
  assert.equal(result.error, null);
  assert.equal(result.value, numberProof.storage);
  assert.equal(result.nodesSupplied, numberProof.proof.length);
  assert.equal(result.nodesUsed, result.steps.length);
  assert.ok(result.nodesUsed >= 2);
  assert.ok(result.steps.length >= 2);
  assert.equal(result.steps[0]?.kind, "branch");
});

test("the proven System.Number equals the fixture block number", () => {
  const result = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
    expectedValue: numberProof.storage as `0x${string}`,
  });

  assert.equal(result.status, "present");
  assert.ok(result.value);
  assert.equal(Number(readUintLE(u8(result.value), 4)), fixture.block.number);

  const decoded = decodeStorageValue(numberProof.key, result.value);
  assert.equal(decoded.encoding, "u32-le");
  assert.equal(decoded.value, fixture.block.number);
});

test("a hashed value node is resolved and yields the 80-byte account record", () => {
  const result = verifyStorageProof({
    proof: accountProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: accountProof.key as `0x${string}`,
  });

  assert.equal(result.status, "present");
  assert.equal(result.value, accountProof.storage);
  const hashed = result.steps.filter((step) => step.valueHashed);
  assert.equal(hashed.length, 1, "the leaf must reference its value by hash");
  assert.equal(hashed[0]?.valueLength, 32);
  assert.equal((accountProof.storage?.length ?? 2) / 2 - 1, 80);
});

test("an absent key is proved absent, not errored", () => {
  const result = verifyStorageProof({
    proof: absentProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: absentProof.key as `0x${string}`,
  });

  assert.equal(result.status, "absent");
  assert.equal(result.rootMatches, true);
  assert.equal(result.value, null);
  assert.ok(["NO_CHILD", "PATH_DIVERGED", "BRANCH_WITHOUT_VALUE"].includes(result.error?.kind ?? ""));
  assert.equal(absentProof.storage, null);
});

/* ------------------------------------------------------------ negatives */

test("tampering the root node fails the root check, not a value check", () => {
  const rootNode = nodeForHash(numberProof.proof, fixture.block.stateRoot);
  const tampered = numberProof.proof.map((node) =>
    node === rootNode ? tamperHex(node, 3) : node,
  );

  const result = verifyStorageProof({
    proof: tampered,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.rootMatches, false);
  assert.equal(result.error?.kind, "ROOT_MISSING");
  assert.equal(result.value, null);
});

test("tampering a child node is caught as a missing node, never as a value", () => {
  const walked = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: fixture.block.stateRoot,
    key: numberProof.key,
  });

  // The first walked node below the root that is a separate proof node. (An
  // inline child is part of its parent's bytes, so it has no entry of its own.)
  const childStep = walked.steps.find(
    (step, index) => index > 0 && findNodeForHash(numberProof.proof, step.node) !== undefined,
  );
  assert.ok(childStep, "the walk must descend through a hash-referenced node");

  const tampered = tamperNodesForHash(numberProof.proof, childStep.node, 2);
  assert.notDeepEqual(tampered, [...numberProof.proof]);

  const result = verifyStorageProof({
    proof: tampered,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.error?.kind, "NODE_MISSING");
  assert.equal(result.value, null);
});

test("a wrong key does not verify the stored value", () => {
  const wrongKey = `${numberProof.key.slice(0, -1)}${numberProof.key.endsWith("c") ? "d" : "c"}`;

  const result = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: wrongKey as `0x${string}`,
  });

  assert.notEqual(result.status, "present");
  assert.equal(result.value, null);
  assert.equal(result.rootMatches, true);
});

test("a stale or incorrect root is refused", () => {
  const wrongRoot = `0x${"11".repeat(32)}` as `0x${string}`;
  const result = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: wrongRoot,
    key: numberProof.key as `0x${string}`,
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.rootMatches, false);
  assert.equal(result.error?.kind, "ROOT_MISSING");
});

test("a proof missing a structural node is incomplete, not absent", () => {
  const pruned = numberProof.proof.slice(0, -1);
  const result = verifyStorageProof({
    proof: pruned,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.error?.kind, "NODE_MISSING");
});

test("a proof missing the value node is incomplete, not absent", () => {
  // Find the node the hashed leaf references, by hash, and drop exactly it.
  const walk = verifyStorageProof({
    proof: accountProof.proof,
    rootHash: fixture.block.stateRoot,
    key: accountProof.key,
  });
  const leafStep = walk.steps[walk.steps.length - 1];
  assert.ok(leafStep?.valueHashed);

  const leafNode = nodeForHash(accountProof.proof, leafStep.node);
  const decoded = decodeNode(u8(leafNode));
  assert.equal(decoded.kind, "leaf");
  assert.equal(decoded.kind === "leaf" ? decoded.value.kind : null, "hashed");

  const reference =
    decoded.kind === "leaf" && decoded.value.kind === "hashed"
      ? bytesToHex(decoded.value.hash)
      : "";

  const pruned = accountProof.proof.filter(
    (node) => bytesToHex(blake2AsU8a(u8(node), 256)) !== reference,
  );
  assert.equal(pruned.length, accountProof.proof.length - 1);

  const result = verifyStorageProof({
    proof: pruned,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: accountProof.key as `0x${string}`,
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.error?.kind, "VALUE_NODE_MISSING");
  assert.match(result.error?.message ?? "", /incomplete, not absent/);
});

test("a conflicting claim is reported as a mismatch with the real value kept", () => {
  const result = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
    expectedValue: "0xdeadbeef",
  });

  assert.equal(result.status, "mismatch");
  assert.equal(result.error?.kind, "VALUE_MISMATCH");
  assert.equal(result.value, numberProof.storage);
  assert.equal(result.expectedValue, "0xdeadbeef");
});

test("claiming absence for a present key is a mismatch", () => {
  const result = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
    expectedValue: null,
  });

  assert.equal(result.status, "mismatch");
  assert.equal(result.error?.kind, "VALUE_MISMATCH");
});

test("an empty proof and a malformed root are refused as input errors", () => {
  const empty = verifyStorageProof({
    proof: [],
    rootHash: fixture.block.stateRoot as `0x${string}`,
    key: numberProof.key as `0x${string}`,
  });
  assert.equal(empty.status, "incomplete");
  assert.equal(empty.error?.kind, "EMPTY_PROOF");

  const badRoot = verifyStorageProof({
    proof: numberProof.proof,
    rootHash: "0x1234" as `0x${string}`,
    key: numberProof.key as `0x${string}`,
  });
  assert.equal(badRoot.status, "invalid");
  assert.equal(badRoot.error?.kind, "INVALID_INPUT");
});

test("System.Number is decoded little-endian and a wrong width is a note", () => {
  const ok = decodeStorageValue(numberProof.key, numberProof.storage as `0x${string}`);
  assert.equal(ok.value, fixture.block.number);

  const wrong = decodeStorageValue(numberProof.key, "0x010203");
  assert.equal(wrong.value, null);
  assert.match(wrong.note ?? "", /expected 4 bytes/);
});

test("a branch reads its value before its children, as sp-trie writes it", () => {
  // header 0xc0 (branch with value), bitmap 0x0020 (nibble 5), value 0xbeef,
  // then one 32-byte hash child. Reading children first would return the child
  // hash as the value and turn a present key into a false absence.
  const node = u8(`0xc0200008beef80${"aa".repeat(32)}`);
  const decoded = decodeNode(node);

  assert.equal(decoded.kind, "branch");
  if (decoded.kind !== "branch") return;
  assert.equal(decoded.value?.kind, "inline");
  if (decoded.value?.kind !== "inline") return;
  assert.equal(bytesToHex(decoded.value.bytes), "0xbeef");
  assert.equal(decoded.children.size, 1);
  assert.ok(decoded.children.has(5));
});

