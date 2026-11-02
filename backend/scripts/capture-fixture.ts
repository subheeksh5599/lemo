// Regenerates test/fixtures/system-witness.json from the live node, so the offline
// suite verifies a payload the chain actually produced rather than a hand-built one.

import { mkdir, writeFile } from "node:fs/promises";
import { buildPackage } from "../src/proofs/package.ts";
import { bytes } from "../src/bytes.ts";
import { hash } from "../src/hashing.ts";
import { RpcClient } from "../src/chain/client.ts";
import { PortaldotChain } from "../src/chain/portaldot.ts";
import type { TitleBinding } from "../src/titles/model.ts";

async function main(): Promise<void> {
  const url = process.env["LEMO_RPC_URL"] ?? "https://live-v3-node.portaldot.dev";
  const chain = new PortaldotChain(new RpcClient({ url, timeoutMs: 15_000, attempts: 3 }));
  const identity = await chain.describe();
  const head = await chain.finalizedHead();

  const prefix = bytes.concat(
    hash.twox128(new TextEncoder().encode("System")),
    hash.twox128(new TextEncoder().encode("Account")),
  );

  const sample = await chain.keysWithPrefix(bytes.toHex(prefix), 1, head.hash);
  const first = sample[0];
  if (first === undefined) throw new Error("the chain has no System.Account entries to witness");

  const account = `0x${first.slice(2 + 64 + 32)}`;
  const binding: TitleBinding = {
    titleId: `0x${"ab".repeat(32)}`,
    label: "portaldot-finality-witness",
    genesisHash: identity.genesisHash,
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
  };

  const built = await buildPackage({ chain, identity, binding });

  const target = new URL("../test/fixtures/system-witness.json", import.meta.url);
  await mkdir(new URL("../test/fixtures/", import.meta.url), { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      {
        capturedFrom: identity.name,
        capturedAt: new Date().toISOString(),
        genesisHash: identity.genesisHash,
        binding,
        package: built.package,
      },
      null,
      2,
    ),
  );

  console.log(`captured block ${built.package.block.number}, ${built.package.proof.length} nodes -> ${target.pathname}`);
}

await main();
