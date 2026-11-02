import { test } from "node:test";
import assert from "node:assert/strict";
import { StatementStore, topicFor } from "../src/statements/store.ts";
import { EvmClient } from "../src/chain/evm.ts";

type Stub = (method: string, params: readonly unknown[]) => { result?: unknown; error?: { message: string } };

function stubFetch(handler: Stub): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body?: string }) => {
    const request = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    const answer = handler(request.method, request.params);
    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, ...answer }),
    };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("the topic for a title is derived from its id, lowercased", () => {
  assert.equal(topicFor("0xAB"), "lemo/0xab");
  const store = new StatementStore({ url: "http://localhost:1", timeoutMs: 1000 });
  assert.equal(store.topicFor("0xAB"), "lemo/0xab");
});

test("an announcement is queued when the node accepts it", async () => {
  const restore = stubFetch((method) => {
    if (method === "rpc_methods") return { result: ["statement_submit", "statement_subscribeStatement"] };
    return { result: { ok: true } };
  });

  try {
    const store = new StatementStore({ url: "http://localhost:1", timeoutMs: 1000 });
    const outcome = await store.announce({ titleId: "0xab", revision: "4", digest: "0x" + "11".repeat(32), blockNumber: 90 });
    assert.equal(outcome.status, "queued");
  } finally {
    restore();
  }
});

test("a node without statement_submit is reported unsupported, never as delivered", async () => {
  const restore = stubFetch((method) => {
    if (method === "rpc_methods") return { result: ["chain_getHeader"] };
    return { result: { ok: true } };
  });

  try {
    const store = new StatementStore({ url: "http://localhost:1", timeoutMs: 1000 });
    const outcome = await store.announce({ titleId: "0xab", revision: "4", digest: "0x" + "11".repeat(32), blockNumber: 90 });
    assert.equal(outcome.status, "unsupported");
    assert.equal(await store.supported(), false);
  } finally {
    restore();
  }
});

test("a refusal from the node is surfaced with its own reason", async () => {
  const restore = stubFetch((method) => {
    if (method === "rpc_methods") return { result: ["statement_submit"] };
    return { result: { ok: false, error: "allowance exceeded" } };
  });

  try {
    const store = new StatementStore({ url: "http://localhost:1", timeoutMs: 1000 });
    const outcome = await store.announce({ titleId: "0xab", revision: "4", digest: "0x" + "11".repeat(32), blockNumber: 90 });
    assert.equal(outcome.status, "rejected");
    assert.match(outcome.status === "rejected" ? outcome.reason : "", /allowance exceeded/);
  } finally {
    restore();
  }
});

test("an EVM node without the eth_ namespace is reported unavailable, not zero", async () => {
  const restore = stubFetch(() => ({ error: { message: "Method not found" } }));

  try {
    const client = new EvmClient({ url: "http://localhost:1", timeoutMs: 1000 });
    const capability = await client.capabilities();
    assert.equal(capability.available, false);

    const supply = await client.totalSupply(`0x${"11".repeat(20)}`);
    assert.equal(supply.status, "unavailable");
    assert.match(supply.status === "unavailable" ? supply.reason : "", /Method not found/);
  } finally {
    restore();
  }
});

test("an EVM node that answers reports the supply it returns", async () => {
  const restore = stubFetch((method) => {
    if (method === "eth_chainId") return { result: "0x190f1ca9" };
    if (method === "eth_call") return { result: "0x05" };
    return { result: "0x600" + "00".repeat(2) };
  });

  try {
    const client = new EvmClient({ url: "http://localhost:1", timeoutMs: 1000 });
    const capability = await client.capabilities();
    assert.equal(capability.available, true);
    assert.equal(capability.available ? capability.chainId : 0, 420420777);

    const supply = await client.totalSupply(`0x${"11".repeat(20)}`);
    assert.equal(supply.status, "read");
    assert.equal(supply.status === "read" ? supply.value : -1n, 5n);

    const code = await client.codeSize(`0x${"11".repeat(20)}`);
    assert.equal(code.status === "read" ? code.value : -1n, 3n);
  } finally {
    restore();
  }
});
