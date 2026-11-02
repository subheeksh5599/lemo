// Live suite: the service against the real Portaldot V3 node. Skipped unless
// LEMO_LIVE=1, because it depends on a reachable chain head.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcClient } from "../src/chain/client.ts";
import { PortaldotChain } from "../src/chain/portaldot.ts";
import { ChainService } from "../src/service.ts";
import { Store } from "../src/store.ts";
import { HttpServer } from "../src/http/server.ts";
import { bytes } from "../src/bytes.ts";
import { hash } from "../src/hashing.ts";
import type { Config } from "../src/config.ts";

const live = process.env["LEMO_LIVE"] === "1";
const rpcUrl = process.env["LEMO_RPC_URL"] ?? "https://live-v3-node.portaldot.dev";

async function startService(): Promise<{ base: string; server: HttpServer; chain: PortaldotChain }> {
  const dir = await mkdtemp(join(tmpdir(), "lemo-live-"));
  const config: Config = {
    port: 0,
    databasePath: join(dir, "lemo.db"),
    rpcUrl,
    rpcTimeoutMs: 15_000,
    rpcAttempts: 3,
    minConfirmations: 0,
    maxKeysPerPackage: 8,
  };

  const chain = new PortaldotChain(new RpcClient({ url: rpcUrl, timeoutMs: config.rpcTimeoutMs, attempts: config.rpcAttempts }));
  const service = new ChainService({ chain, store: new Store(config.databasePath), config });
  const server = new HttpServer({ service, config });
  const { port } = await server.listen();
  return { base: `http://127.0.0.1:${port}`, server, chain };
}

async function witnessAccount(chain: PortaldotChain): Promise<string> {
  const prefix = bytes.concat(
    hash.twox128(new TextEncoder().encode("System")),
    hash.twox128(new TextEncoder().encode("Account")),
  );
  const head = await chain.finalizedHead();
  const [key] = await chain.keysWithPrefix(bytes.toHex(prefix), 1, head.hash);
  if (key === undefined) throw new Error("no System.Account entry to witness");
  return `0x${key.slice(2 + 64 + 32)}`;
}

test("a title on the live chain yields a package that verifies and cannot be replayed", { skip: !live }, async () => {
  const { base, server, chain } = await startService();

  try {
    const account = await witnessAccount(chain);
    const titleId = `0x${"cd".repeat(32)}`;

    const registered = await fetch(`${base}/titles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titleId,
        label: "live witness",
        fields: [
          { label: "revision", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
          {
            label: "owner",
            pallet: "System",
            item: "Account",
            hasher: "blake2_128_concat",
            args: [{ type: "account32", value: account }],
            decode: "bytes",
          },
        ],
      }),
    });
    assert.equal(registered.status, 201);

    const proofResponse = await fetch(`${base}/titles/${titleId}/proof`);
    assert.equal(proofResponse.status, 200);
    const built = (await proofResponse.json()) as {
      package: { digest: string; block: { number: number; stateRoot: string }; proof: string[] };
      revision: string;
      report: { valid: boolean };
      readings: { label: string; status: string }[];
    };

    assert.equal(built.report.valid, true);
    assert.equal(Number(built.revision), built.package.block.number);
    assert.equal(built.readings.every((reading) => reading.status === "present"), true);

    const verified = await fetch(`${base}/proofs/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: built.package }),
    });
    assert.equal(((await verified.json()) as { valid: boolean }).valid, true);

    const consume = async (): Promise<number> => {
      const response = await fetch(`${base}/proofs/consume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digest: built.package.digest, titleId, operation: "unlock-backing" }),
      });
      return response.status;
    };
    assert.equal(await consume(), 201);
    assert.equal(await consume(), 409);

    const forged = { ...built.package, block: { ...built.package.block, stateRoot: `0x${"12".repeat(32)}` } };
    const forgedResponse = await fetch(`${base}/proofs/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: forged }),
    });
    assert.equal(((await forgedResponse.json()) as { valid: boolean }).valid, false);

    const unknownTitle = await fetch(`${base}/titles/0x${"00".repeat(32)}/proof`);
    assert.equal(unknownTitle.status, 404);
  } finally {
    await server.close();
  }
});

