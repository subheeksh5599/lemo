import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import type { TitleBinding } from "../src/titles/model.ts";

function freshStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "lemo-store-"));
  return new Store(join(dir, "test.db"));
}

const binding: TitleBinding = {
  titleId: `0x${"ab".repeat(32)}`,
  label: "store test",
  genesisHash: `0x${"cd".repeat(32)}`,
  fields: [
    { label: "revision", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
  ],
  evm: { contract: `0x${"ef".repeat(20)}`, standard: "erc20" },
};

test("a title binding round-trips, including its EVM representation", () => {
  const store = freshStore();
  store.saveTitle(binding);

  const restored = store.getTitle(binding.titleId);
  assert.deepEqual(restored, binding);
  assert.equal(store.listTitles().length, 1);
  store.close();
});

test("a revision moves forward and never backwards", () => {
  const store = freshStore();
  store.saveTitle(binding);

  const first = store.acceptRevision({ titleId: binding.titleId, revision: "7", digest: "0xaa", blockNumber: 100 });
  assert.equal(first.status, "accepted");
  assert.equal(first.previous, null);

  const second = store.acceptRevision({ titleId: binding.titleId, revision: "8", digest: "0xbb", blockNumber: 101 });
  assert.equal(second.status, "accepted");
  assert.equal(second.previous, "7");

  const stale = store.acceptRevision({ titleId: binding.titleId, revision: "6", digest: "0xcc", blockNumber: 102 });
  assert.equal(stale.status, "stale");
  assert.equal(stale.status === "stale" ? stale.accepted : null, "8");
  assert.equal(store.acceptedRevision(binding.titleId), "8");

  const history = store.revisionHistory(binding.titleId, 10);
  assert.deepEqual(
    history.map((entry) => entry.revision),
    ["8", "7"],
  );
  store.close();
});

test("re-accepting the same revision updates its digest instead of duplicating it", () => {
  const store = freshStore();
  store.saveTitle(binding);

  store.acceptRevision({ titleId: binding.titleId, revision: "9", digest: "0xaa", blockNumber: 200 });
  store.acceptRevision({ titleId: binding.titleId, revision: "9", digest: "0xbb", blockNumber: 201 });

  const history = store.revisionHistory(binding.titleId, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.digest, "0xbb");
  store.close();
});

test("a consumed digest is refused the second time with the first record attached", () => {
  const store = freshStore();
  const first = store.consume("0x" + "11".repeat(32), binding.titleId, "unlock");
  assert.equal(first.status, "consumed");

  const second = store.consume("0x" + "11".repeat(32), binding.titleId, "unlock");
  assert.equal(second.status, "replayed");
  assert.equal(second.status === "replayed" ? second.operation : null, "unlock");
  store.close();
});

test("counts reflect what was stored", () => {
  const store = freshStore();
  store.saveTitle(binding);
  store.acceptRevision({ titleId: binding.titleId, revision: "1", digest: "0xaa", blockNumber: 1 });
  store.consume("0x" + "22".repeat(32), binding.titleId, "redeem");

  assert.deepEqual(store.counts(), { titles: 1, acceptedRevisions: 1, consumedProofs: 1 });
  store.close();
});
