import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes } from "../src/bytes.ts";
import { hash } from "../src/hashing.ts";
import { openProof, ProofError } from "../src/trie/proof.ts";
import { encodeCompact } from "../src/scale.ts";

function packPartial(partial: readonly number[]): Uint8Array {
  const nibbles = partial.length % 2 === 1 ? [0, ...partial] : [...partial];
  const packed = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < packed.length; i += 1) {
    packed[i] = ((nibbles[i * 2] ?? 0) << 4) | (nibbles[i * 2 + 1] ?? 0);
  }
  return packed;
}

/** Test-side encoder for the node format the decoder must read. */
function leaf(value: Uint8Array, partial: readonly number[]): Uint8Array {
  return bytes.concat(Uint8Array.of(0x40 + partial.length), packPartial(partial), encodeCompact(value.length), value);
}

function branch(children: readonly (Uint8Array | null)[]): Uint8Array {
  let bitmap = 0;
  for (let nibble = 0; nibble < 16; nibble += 1) {
    if (children[nibble] != null) bitmap |= 1 << nibble;
  }

  const parts: Uint8Array[] = [Uint8Array.of(0x80), new Uint8Array(0), Uint8Array.of(bitmap & 0xff, (bitmap >> 8) & 0xff)];
  for (let nibble = 0; nibble < 16; nibble += 1) {
    const child = children[nibble];
    if (child == null) continue;
    parts.push(encodeCompact(child.length), child);
  }
  return bytes.concat(...parts);
}

function rootOf(node: Uint8Array): Uint8Array {
  return hash.blake2b256(node);
}

test("a leaf node proves its own key and refuses any other", () => {
  const node = leaf(new TextEncoder().encode("title"), [0xa, 0xb, 0xc, 0xb]);
  const proof = openProof([node], rootOf(node));

  const hit = proof.lookup(bytes.fromHex("0xabcb"));
  assert.equal(hit.status, "present");
  if (hit.status === "present") assert.equal(new TextDecoder().decode(hit.value), "title");

  assert.equal(proof.lookup(bytes.fromHex("0xabcc")).status, "absent");
  assert.equal(proof.lookup(bytes.fromHex("0xff")).status, "absent");
});

test("a branch dispatches on the nibble that follows its partial key", () => {
  const child0 = leaf(new TextEncoder().encode("zero"), [0, 0, 0]);
  const child1 = leaf(new TextEncoder().encode("one"), [0, 0, 0]);
  const node = branch([child0, child1]);
  const proof = openProof([node], rootOf(node));

  const zero = proof.lookup(bytes.fromHex("0x0000"));
  assert.equal(zero.status, "present");
  if (zero.status === "present") assert.equal(new TextDecoder().decode(zero.value), "zero");

  const one = proof.lookup(bytes.fromHex("0x1000"));
  assert.equal(one.status, "present");
  if (one.status === "present") assert.equal(new TextDecoder().decode(one.value), "one");

  assert.equal(proof.lookup(bytes.fromHex("0x2000")).status, "absent");
});

test("a proof whose nodes do not hash to the state root is refused", () => {
  const node = leaf(new TextEncoder().encode("title"), [0xa]);
  const forgedRoot = hash.blake2b256(new TextEncoder().encode("something else"));

  assert.throws(
    () => openProof([node], forgedRoot),
    (cause: unknown) => cause instanceof ProofError && cause.code === "ROOT_NOT_IN_PROOF",
  );
});

test("a single flipped byte in a proof node breaks the root", () => {
  const node = leaf(new TextEncoder().encode("title"), [0xa]);
  const tampered = Uint8Array.from(node);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;

  assert.throws(
    () => openProof([tampered], rootOf(node)),
    (cause: unknown) => cause instanceof ProofError && cause.code === "ROOT_NOT_IN_PROOF",
  );
});

test("a proof that omits a child node reports an incomplete path, never a guess", () => {
  const child = leaf(new TextEncoder().encode("deep"), [0, 0, 0]);
  const node = branch([hash.blake2b256(child)]);
  const proof = openProof([node], rootOf(node));

  assert.throws(
    () => proof.lookup(bytes.fromHex("0x0000")),
    (cause: unknown) => cause instanceof ProofError && cause.code === "PATH_INCOMPLETE",
  );
});

test("an empty proof is an error, not an empty state", () => {
  assert.throws(
    () => openProof([], new Uint8Array(32)),
    (cause: unknown) => cause instanceof ProofError && cause.code === "EMPTY_PROOF",
  );
});
