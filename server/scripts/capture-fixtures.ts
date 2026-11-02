/**
 * Captures a real `state_getReadProof` set from the public Portaldot V3 testnet
 * and writes it to `test/fixtures/portaldot-v3.json`.
 *
 * Run from the server directory so Node resolves the package's node_modules:
 *
 *     node scripts/capture-fixtures.ts
 *
 * The script refuses to write a fixture it cannot verify: every proof is opened
 * against the finalized state root, compared with `state_getStorage` at the same
 * block, and the `System.Number` reading must equal that block's own number.
 * A fixture that failed those checks would be worthless offline evidence.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTALDOT_V3_TESTNET } from "../src/config.ts";
import { palletItemKey, SYSTEM_ACCOUNT_PREFIX } from "../src/proofs/keys.ts";
import { verifyStorageProof, type ProofResult } from "../src/proofs/trie.ts";
import { hexToBytes, readUintLE } from "../src/util/bytes.ts";
import { EvmClient } from "../src/rpc/evm.ts";
import { JsonRpcClient } from "../src/rpc/jsonRpc.ts";
import { SubstrateClient } from "../src/rpc/substrate.ts";
import type { Hex } from "../src/rpc/substrate.ts";

// The public endpoints drop connections after a couple of quick calls, so this
// capture is deliberately slow: one request in flight, long backoff on 503.
const chain = new SubstrateClient(
  new JsonRpcClient({
    url: PORTALDOT_V3_TESTNET.substrateRpc,
    timeoutMs: 30_000,
    maxConcurrency: 1,
    maxAttempts: 8,
    retryDelayMs: 2_000,
    maxRetryDelayMs: 30_000,
  }),
);
const evm = new EvmClient(
  new JsonRpcClient({
    url: PORTALDOT_V3_TESTNET.evmRpc,
    timeoutMs: 30_000,
    maxConcurrency: 1,
    maxAttempts: 8,
    retryDelayMs: 2_000,
    maxRetryDelayMs: 30_000,
  }),
);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type Capture = {
  readonly label: string;
  readonly key: Hex;
  readonly storage: Hex | null;
  readonly proof: readonly Hex[];
  readonly verification: ProofResult;
};

async function capture(label: string, key: Hex, at: Hex, stateRoot: Hex): Promise<Capture> {
  const proof = await chain.readProof([key], at);
  await sleep(1_500);
  const storage = await chain.storageOne(key, at);
  await sleep(1_500);
  const verification = verifyStorageProof({
    proof: proof.nodes,
    rootHash: stateRoot,
    key,
  });

  console.log(
    `${label}: ${verification.status} nodes=${proof.nodes.length} used=${verification.nodesUsed}` +
      (verification.error === null ? "" : ` (${verification.error.kind}: ${verification.error.message})`),
  );

  return { label, key, storage, proof: proof.nodes, verification };
}

const finalizedHash = await chain.finalizedHash();
await sleep(1_500);
const header = await chain.header(finalizedHash);
await sleep(1_500);
const genesisHash = await chain.genesisHash();
await sleep(1_500);
const chainName = await chain.systemChain();
await sleep(1_500);
const chainType = await chain.systemChainType();
await sleep(1_500);
const evmChainId = await evm.chainId();
await sleep(1_500);

console.log(`finalized ${finalizedHash} at block ${header.number}`);
console.log(`state root ${header.stateRoot}`);

const numberKey = palletItemKey("System", "Number");
const number = await capture("System.Number", numberKey, finalizedHash, header.stateRoot);

if (number.verification.status !== "present") {
  throw new Error(`System.Number did not verify: ${number.verification.status}`);
}

const value = number.verification.value;

if (value === null) {
  throw new Error("System.Number verified without a value");
}

const decoded = Number(readUintLE(hexToBytes(value), 4));

if (decoded !== header.number) {
  throw new Error(
    `System.Number decoded to ${decoded} but the block is ${header.number}; refusing to write the fixture`,
  );
}

if (number.storage === null || number.storage.toLowerCase() !== value.toLowerCase()) {
  throw new Error(
    `proven value ${value} does not match state_getStorage ${String(number.storage)}`,
  );
}

await sleep(1_500);
const accountKeys = await chain.keysPaged(SYSTEM_ACCOUNT_PREFIX, 1, finalizedHash);
await sleep(1_500);
const accountKey = accountKeys[0];

if (accountKey === undefined) {
  throw new Error("no System.Account key on this chain; cannot capture the hashed-value proof");
}

const account = await capture(
  "System.Account[first key]",
  accountKey,
  finalizedHash,
  header.stateRoot,
);

if (account.verification.status !== "present") {
  throw new Error(`System.Account proof did not verify: ${account.verification.status}`);
}

if (
  account.storage === null ||
  account.verification.value === null ||
  account.storage.toLowerCase() !== account.verification.value.toLowerCase()
) {
  throw new Error("System.Account proven value does not match state_getStorage");
}

const hashedStep = account.verification.steps.find((step) => step.valueHashed);

if (hashedStep === undefined) {
  throw new Error("the captured account proof did not exercise a hashed value node");
}

const absentKey = palletItemKey("System", "LemoDoesNotExist");
const absent = await capture(
  "absent key under the System prefix",
  absentKey,
  finalizedHash,
  header.stateRoot,
);

if (absent.verification.status !== "absent" || absent.storage !== null) {
  throw new Error(
    `absent-key capture disagreed with the node: status=${absent.verification.status} storage=${String(absent.storage)}`,
  );
}

const fixture = {
  capturedAt: new Date().toISOString(),
  network: {
    substrateRpc: PORTALDOT_V3_TESTNET.substrateRpc,
    evmRpc: PORTALDOT_V3_TESTNET.evmRpc,
    chain: chainName,
    chainType,
    genesisHash,
    evmChainId,
  },
  block: {
    hash: finalizedHash,
    number: header.number,
    parentHash: header.parentHash,
    stateRoot: header.stateRoot,
  },
  proofs: {
    systemNumber: {
      label: number.label,
      key: number.key,
      storage: number.storage,
      proof: number.proof,
      verified: {
        status: number.verification.status,
        value,
        decoded,
        nodesUsed: number.verification.nodesUsed,
      },
    },
    systemAccount: {
      label: account.label,
      key: account.key,
      storage: account.storage,
      proof: account.proof,
      verified: {
        status: account.verification.status,
        nodesUsed: account.verification.nodesUsed,
        hashedValueNode: true,
        valueBytes: (account.storage?.length ?? 2) / 2 - 1,
      },
    },
    absentKey: {
      label: absent.label,
      key: absent.key,
      storage: absent.storage,
      proof: absent.proof,
      verified: {
        status: absent.verification.status,
        errorKind: absent.verification.error?.kind ?? null,
        nodesUsed: absent.verification.nodesUsed,
      },
    },
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "test", "fixtures", "portaldot-v3.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

console.log(`\nwrote ${target}`);
console.log(`block ${header.number}  root ${header.stateRoot}`);
console.log(`System.Number proven ${value} (decoded ${decoded}) nodes ${number.proof.length}`);
console.log(`System.Account nodes ${account.proof.length} (hashed value node resolved)`);
console.log(`absent key ${absentKey} proved ${absent.verification.status}`);
