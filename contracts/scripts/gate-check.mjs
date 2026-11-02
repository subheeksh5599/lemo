// Proves the token's transfer gate against the live registry: freeze the title, expect the
// transfer to revert, unfreeze, expect it to move again.

import { readFile } from "node:fs/promises";
import { clients } from "./lib/chain.mjs";

const registry = process.env.LEMO_CONTRACT ?? "0xc88763FA361669fC5d95c2BDD924b0E2872488bB";
const token = process.env.LEMO_TOKEN ?? "0x61c35d5e811b99f2641b43e9ef97e50d52de8ff7";
const titleId = `0x${"ee".repeat(32)}`;
const recipient = "0x000000000000000000000000000000000000beef";

const registryArtifact = JSON.parse(await readFile(new URL("../artifacts/LemoTitle.json", import.meta.url), "utf8"));
const tokenArtifact = JSON.parse(await readFile(new URL("../artifacts/LemoERC20Lite.json", import.meta.url), "utf8"));
const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);

const show = (value) => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
const block = await publicClient.getBlock();
const baseFee = block.baseFeePerGas ?? 0n;

async function write(address, abi, functionName, args) {
  const hash = await walletClient.writeContract({ address, abi, functionName, args, gasPrice: baseFee, type: "legacy" });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { status: receipt.status, hash, block: receipt.blockNumber };
}

const record = await publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: "titles", args: [titleId] });
const [asset, backing, revision, digest] = record;

console.log("title revision:", revision.toString(), "| eligible:", await publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: "eligible", args: [titleId] }));

// 1. Freeze the title.
console.log("\nfreeze :", show(await write(registry, registryArtifact.abi, "set", [titleId, asset, backing, revision, digest, false])));
console.log("eligible:", await publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: "eligible", args: [titleId] }));

// 2. A transfer must now be refused by the token.
try {
  const sent = await write(token, tokenArtifact.abi, "transfer", [recipient, 1n]);
  console.log("transfer while frozen: UNEXPECTED", JSON.stringify(sent));
} catch (error) {
  console.log("transfer while frozen: reverted —", (error.shortMessage ?? error.message ?? "").split("\n")[0]);
}

// 3. Unfreeze and move again.
console.log("\nunfreeze:", show(await write(registry, registryArtifact.abi, "set", [titleId, asset, backing, revision, digest, true])));
console.log("transfer:", show(await write(token, tokenArtifact.abi, "transfer", [recipient, 5n])));
console.log("recipient balance:", String(await publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [recipient] })));
console.log("deployer balance:", (Number(await publicClient.getBalance({ address: account.address })) / 1e18).toFixed(3), "POT");
