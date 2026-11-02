// Settles a verified proof package into the deployed LemoTitle contract: reads the package from a
// running LEMO backend, writes its revision + digest on chain, then reads the record back and
// exercises the eligibility gate. Every step prints the transaction hash.

import { readFile } from "node:fs/promises";
import { clients } from "./lib/chain.mjs";

const base = process.env.LEMO_API ?? "http://127.0.0.1:8793";
const contract = process.env.LEMO_CONTRACT;
const titleId = process.env.LEMO_TITLE_ID ?? `0x${"ee".repeat(32)}`;
if (!contract) throw new Error("LEMO_CONTRACT is not set");

const artifact = JSON.parse(await readFile(new URL("../artifacts/LemoTitle.json", import.meta.url), "utf8"));
const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);

const block = await publicClient.getBlock();
const baseFee = block.baseFeePerGas ?? 0n;

async function send(functionName, args) {
  const hash = await walletClient.writeContract({
    address: contract,
    abi: artifact.abi,
    functionName,
    args,
    gasPrice: baseFee,
    type: "legacy",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`${functionName}: ${receipt.status} block ${receipt.blockNumber} gasUsed ${receipt.gasUsed} tx ${hash}`);
  return receipt;
}

// 1. A real package from the service.
const registered = await fetch(`${base}/titles`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    titleId,
    label: "onchain settlement",
    fields: [
      { label: "revision", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
      { label: "backing", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
    ],
  }),
}).then((response) => response.json());
console.log("binding:", registered.titleId ?? JSON.stringify(registered));

const proof = await fetch(`${base}/titles/${titleId}/proof`).then((response) => response.json());
console.log("package: block", proof.package?.block?.number, "digest", proof.package?.digest, "valid", proof.report?.valid);

if (!proof.package?.digest) throw new Error("the service returned no package");

const revision = BigInt(proof.revision ?? proof.package.block.number);
const backing = BigInt("1000");
const asset = `0x${"ab".repeat(32)}`;

await settle();

async function settle() {
  const existing = await publicClient
    .readContract({ address: contract, abi: artifact.abi, functionName: "titles", args: [titleId] })
    .catch(() => null);

  if (existing === null) {
    console.log("record read failed; continuing with the write");
  }

  await send("set", [titleId, asset, backing, revision, proof.package.digest, true]);

  const record = await publicClient.readContract({
    address: contract,
    abi: artifact.abi,
    functionName: "titles",
    args: [titleId],
  });
  console.log("record:", JSON.stringify(record, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));

  const eligibleNow = await publicClient.readContract({
    address: contract,
    abi: artifact.abi,
    functionName: "eligible",
    args: [titleId],
  });
  console.log("eligible:", eligibleNow);

  await send("set", [titleId, asset, backing, revision, proof.package.digest, false]);
  const afterFreeze = await publicClient.readContract({
    address: contract,
    abi: artifact.abi,
    functionName: "eligible",
    args: [titleId],
  });
  console.log("eligible after freeze:", afterFreeze);

  await send("set", [titleId, asset, backing, revision + 1n, proof.package.digest, true]);
  const afterRevision = await publicClient.readContract({
    address: contract,
    abi: artifact.abi,
    functionName: "titles",
    args: [titleId],
  });
  console.log("revision after bump:", afterRevision[2].toString());

  console.log("deployer balance:", (Number(await publicClient.getBalance({ address: account.address })) / 1e18).toFixed(3), "POT");
}
