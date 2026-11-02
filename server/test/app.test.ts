import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { EvmClient } from "../src/rpc/evm.ts";
import { JsonRpcClient } from "../src/rpc/jsonRpc.ts";
import { SubstrateClient } from "../src/rpc/substrate.ts";
import { ProofService } from "../src/service.ts";
import { loadFixture, tamperNodesForHash } from "./helpers/fixture.ts";
import { startFakeNode, type FakeNodeOptions } from "./helpers/fakeNode.ts";

const fixture = loadFixture();

type Envelope = {
  requestId: string;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
};

type Harness = {
  readonly app: FastifyInstance;
  readonly close: () => Promise<void>;
};

/**
 * A real Fastify app, a real HTTP hop to a stand-in node, and the real captured
 * proof. Only the node's transport is faked.
 */
async function harness(overrides: Partial<FakeNodeOptions> = {}): Promise<Harness> {
  const fake = await startFakeNode({ fixture, ...overrides });
  const config = loadConfig({
    LEMO_SUBSTRATE_RPC: fake.substrateUrl,
    LEMO_EVM_RPC: fake.evmUrl,
    LEMO_GENESIS_HASH: fixture.network.genesisHash,
    LEMO_CHAIN_ID: String(fixture.network.evmChainId),
    LEMO_LOG_LEVEL: "error",
  } as NodeJS.ProcessEnv);

  const substrate = new SubstrateClient(
    new JsonRpcClient({ url: config.substrate.url, timeoutMs: 5_000 }),
  );
  const evm = new EvmClient(new JsonRpcClient({ url: config.evm.url, timeoutMs: 5_000 }));
  const service = new ProofService({ config, substrate, evm });
  const app = await buildApp({ config, service, logger: false });

  return {
    app,
    close: async () => {
      await app.close();
      await fake.close();
    },
  };
}

function envelope(raw: string): Envelope {
  return JSON.parse(raw) as Envelope;
}

test("GET /healthz reports liveness with a request id", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({ method: "GET", url: "/healthz" });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);

    const parsed = envelope(response.body);
    assert.equal(parsed.requestId, response.headers["x-request-id"]);
    assert.equal((parsed.data as { status: string }).status, "ok");
    assert.equal(typeof (parsed.data as { uptimeSeconds: number }).uptimeSeconds, "number");
  } finally {
    await h.close();
  }
});

test("GET /v1/network matches genesis and reports the EVM refusal honestly", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({ method: "GET", url: "/v1/network" });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      substrate: { chain: string; genesisMatches: boolean; genesisHash: string };
      heads: { best: { number: number }; finalized: { number: number }; finalityLagBlocks: number };
      evm: { chainId: number; chainIdMatches: boolean; readProofSupported: boolean; note: string | null };
      latencyMs: Record<string, number>;
    };

    assert.equal(data.substrate.chain, fixture.network.chain);
    assert.equal(data.substrate.genesisMatches, true);
    assert.equal(data.substrate.genesisHash, fixture.network.genesisHash);
    assert.equal(data.heads.finalized.number, fixture.block.number);
    assert.ok(data.heads.finalityLagBlocks >= 0);
    assert.equal(data.evm.chainId, fixture.network.evmChainId);
    assert.equal(data.evm.chainIdMatches, true);
    assert.equal(data.evm.readProofSupported, false);
    assert.match(data.evm.note ?? "", /Method not found/);
    assert.ok(Object.keys(data.latencyMs).includes("chain_getHeader#finalized"));
  } finally {
    await h.close();
  }
});

test("GET /v1/network flags a genesis mismatch instead of hiding it", async () => {
  const h = await harness({ genesisHash: `0x${"22".repeat(32)}` });

  try {
    const response = await h.app.inject({ method: "GET", url: "/v1/network" });
    const data = envelope(response.body).data as { substrate: { genesisMatches: boolean } };
    assert.equal(data.substrate.genesisMatches, false);
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/native proves System.Number against the finalized root", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "GET",
      url: `/v1/witness/native?key=${fixture.proofs.systemNumber.key}&at=finalized`,
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      nodes: string[];
      nodeCount: number;
      block: { hash: string; number: number; stateRoot: string };
      verification: { status: string; value: string; steps: unknown[]; rootMatches: boolean };
      storageValue: string;
      agreesWithStorage: boolean;
      decoded: { encoding: string; value: number } | null;
      blockNumberAgrees: boolean;
    };

    assert.equal(data.block.hash, fixture.block.hash);
    assert.equal(data.block.number, fixture.block.number);
    assert.equal(data.verification.status, "present");
    assert.equal(data.verification.rootMatches, true);
    assert.equal(data.verification.value, fixture.proofs.systemNumber.storage);
    assert.equal(data.storageValue, fixture.proofs.systemNumber.storage);
    assert.equal(data.agreesWithStorage, true);
    assert.equal(data.nodeCount, fixture.proofs.systemNumber.proof.length);
    assert.equal(data.nodes.length, data.nodeCount);
    assert.equal(data.decoded?.encoding, "u32-le");
    assert.equal(data.decoded?.value, fixture.block.number);
    assert.equal(data.blockNumberAgrees, true);
    assert.ok(data.verification.steps.length >= 2);
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/native resolves a hashed value node for a large record", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "GET",
      url: `/v1/witness/native?key=${fixture.proofs.systemAccount.key}`,
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      verification: { status: string; value: string; steps: { valueHashed: boolean }[] };
      agreesWithStorage: boolean;
      decoded: { encoding: string } | null;
      blockNumberAgrees: boolean | null;
    };

    assert.equal(data.verification.status, "present");
    assert.equal(data.verification.value, fixture.proofs.systemAccount.storage);
    assert.equal(data.agreesWithStorage, true);
    assert.ok(data.verification.steps.some((step) => step.valueHashed));
    assert.equal(data.decoded?.encoding, "opaque");
    assert.equal(data.blockNumberAgrees, null);
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/native proves an absent key absent and agrees with storage", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "GET",
      url: `/v1/witness/native?key=${fixture.proofs.absentKey.key}`,
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      verification: { status: string; value: null };
      storageValue: null;
      agreesWithStorage: boolean;
      decoded: null;
    };

    assert.equal(data.verification.status, "absent");
    assert.equal(data.verification.value, null);
    assert.equal(data.storageValue, null);
    assert.equal(data.agreesWithStorage, true);
    assert.equal(data.decoded, null);
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/native rejects a malformed key with field-level detail", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({ method: "GET", url: "/v1/witness/native?key=0xzz" });
    assert.equal(response.statusCode, 400);

    const parsed = envelope(response.body);
    assert.equal(parsed.error?.code, "INVALID_REQUEST");
    assert.ok(Array.isArray(parsed.error?.details));
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/native rejects unknown query parameters", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "GET",
      url: `/v1/witness/native?key=${fixture.proofs.systemNumber.key}&root=0x${"33".repeat(32)}`,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(envelope(response.body).error?.code, "INVALID_REQUEST");
  } finally {
    await h.close();
  }
});

test("POST /v1/verify/native verifies a supplied proof against the chain root", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      payload: {
        key: fixture.proofs.systemNumber.key,
        proof: fixture.proofs.systemNumber.proof,
      },
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      verified: boolean;
      present: boolean;
      rootSource: string;
      proofSource: string;
      value: string;
      block: { stateRoot: string };
      verification: { status: string };
    };

    assert.equal(data.verified, true);
    assert.equal(data.present, true);
    assert.equal(data.rootSource, "chain");
    assert.equal(data.proofSource, "supplied");
    assert.equal(data.value, fixture.proofs.systemNumber.storage);
    assert.equal(data.block.stateRoot, fixture.block.stateRoot);
  } finally {
    await h.close();
  }
});

test("POST /v1/verify/native fetches a proof when none is supplied", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      payload: { key: fixture.proofs.systemNumber.key },
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as { verified: boolean; proofSource: string };
    assert.equal(data.verified, true);
    assert.equal(data.proofSource, "fetched");
  } finally {
    await h.close();
  }
});

test("POST /v1/verify/native rejects a tampered root node, naming the failed check", async () => {
  const h = await harness();

  try {
    const tampered = tamperNodesForHash(fixture.proofs.systemNumber.proof, fixture.block.stateRoot, 3);

    const response = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      payload: { key: fixture.proofs.systemNumber.key, proof: tampered },
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      verified: boolean;
      value: null;
      verification: { status: string; rootMatches: boolean; error: { kind: string } };
    };

    assert.equal(data.verified, false);
    assert.equal(data.value, null);
    assert.equal(data.verification.rootMatches, false);
    assert.equal(data.verification.error.kind, "ROOT_MISSING");
  } finally {
    await h.close();
  }
});

test("POST /v1/verify/native refuses a caller-supplied root field outright", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      payload: {
        key: fixture.proofs.systemNumber.key,
        proof: fixture.proofs.systemNumber.proof,
        root: `0x${"44".repeat(32)}`,
      },
    });

    assert.equal(response.statusCode, 400);
    const parsed = envelope(response.body);
    assert.equal(parsed.error?.code, "INVALID_REQUEST");
    assert.match(JSON.stringify(parsed.error?.details), /root/u);
  } finally {
    await h.close();
  }
});

test("POST /v1/verify/native reports a conflicting value claim as a mismatch", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      payload: {
        key: fixture.proofs.systemNumber.key,
        proof: fixture.proofs.systemNumber.proof,
        value: "0xdeadbeef",
      },
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      verified: boolean;
      present: boolean;
      value: string;
      verification: { status: string; error: { kind: string } };
    };

    assert.equal(data.verified, false);
    assert.equal(data.present, true);
    assert.equal(data.value, fixture.proofs.systemNumber.storage);
    assert.equal(data.verification.status, "mismatch");
    assert.equal(data.verification.error.kind, "VALUE_MISMATCH");
  } finally {
    await h.close();
  }
});

test("POST /v1/verify/native refuses a block outside the freshness window", async () => {
  const h = await harness({ finalizedAheadBy: 1_000 });

  try {
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      payload: { key: fixture.proofs.systemNumber.key, at: fixture.block.number },
    });

    assert.equal(response.statusCode, 409);
    const parsed = envelope(response.body);
    assert.equal(parsed.error?.code, "STALE_PROOF");
    assert.match(parsed.error?.message ?? "", /behind the finalized head/);
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/evm reports the node's own refusal and no witness", async () => {
  const h = await harness();

  try {
    const address = "0x00000000000000000000000000000000000000aa";
    const response = await h.app.inject({
      method: "GET",
      url: `/v1/witness/evm?address=${address}`,
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      supported: boolean;
      witness: null;
      reason: { code: number; message: string; method: string };
      evm: { chainId: number };
      note: string;
    };

    assert.equal(data.supported, false);
    assert.equal(data.witness, null);
    assert.equal(data.reason.method, "eth_getProof");
    assert.equal(data.reason.code, -32601);
    assert.match(data.reason.message, /Method not found/);
    assert.equal(data.evm.chainId, fixture.network.evmChainId);
    assert.match(data.note, /does not implement eth_getProof/);
  } finally {
    await h.close();
  }
});

test("GET /v1/witness/evm returns an unverified proof when the node has the method", async () => {
  const h = await harness({ ethGetProof: true });

  try {
    const response = await h.app.inject({
      method: "GET",
      url: "/v1/witness/evm?address=0x00000000000000000000000000000000000000aa",
    });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      supported: boolean;
      reason: null;
      witness: { verified: boolean; accountProofNodes: number; note: string };
    };

    assert.equal(data.supported, true);
    assert.equal(data.reason, null);
    assert.equal(data.witness.verified, false);
    assert.ok(data.witness.accountProofNodes >= 1);
    assert.match(data.witness.note, /no EVM trie verifier/);
  } finally {
    await h.close();
  }
});

test("GET /v1/reads lists every RPC method the service calls", async () => {
  const h = await harness();

  try {
    const response = await h.app.inject({ method: "GET", url: "/v1/reads" });
    assert.equal(response.statusCode, 200);

    const data = envelope(response.body).data as {
      reads: { method: string; transport: string; usedBy: string[] }[];
      notes: string[];
    };

    const methods = data.reads.map((read) => read.method);
    for (const method of [
      "chain_getBlockHash",
      "chain_getFinalizedHead",
      "chain_getHeader",
      "state_getReadProof",
      "state_getStorage",
      "eth_chainId",
      "eth_getProof",
    ]) {
      assert.ok(methods.includes(method), `missing ${method}`);
    }

    assert.equal(data.reads.every((read) => read.usedBy.length > 0), true);
    assert.ok(data.notes.length > 0);
  } finally {
    await h.close();
  }
});

test("unknown routes and unreadable bodies fail with structured errors", async () => {
  const h = await harness();

  try {
    const missing = await h.app.inject({ method: "GET", url: "/v1/nope" });
    assert.equal(missing.statusCode, 404);
    assert.equal(envelope(missing.body).error?.code, "NOT_FOUND");

    const malformed = await h.app.inject({
      method: "POST",
      url: "/v1/verify/native",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(envelope(malformed.body).error?.code, "INVALID_REQUEST");
    assert.ok(malformed.headers["x-request-id"]);
  } finally {
    await h.close();
  }
});

test("CORS is explicit and a known path rejects the wrong method", async () => {
  const h = await harness();

  try {
    const network = await h.app.inject({ method: "GET", url: "/v1/network" });
    assert.equal(network.statusCode, 200);
    assert.equal(network.headers["access-control-allow-origin"], "*");

    const preflight = await h.app.inject({ method: "OPTIONS", url: "/v1/network" });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-methods"], "GET, POST, OPTIONS");

    const wrongMethod = await h.app.inject({ method: "POST", url: "/v1/network" });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, "GET");
    assert.equal(envelope(wrongMethod.body).error?.code, "METHOD_NOT_ALLOWED");
  } finally {
    await h.close();
  }
});

test("the app binds a real port and closes cleanly", async () => {
  const h = await harness();

  try {
    const address = await h.app.listen({ host: "127.0.0.1", port: 0 });
    assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${address}/healthz`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("x-request-id"));

    const body = (await response.json()) as Envelope;
    assert.equal(body.data?.status, "ok");
  } finally {
    await h.close();
  }
});
