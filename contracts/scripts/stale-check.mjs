// Hostile-path check on the live contract: writing an older revision must revert.

import { readFile } from "node:fs/promises";
import { clients } from "./lib/chain.mjs";

const contract = process.env.LEMO_CONTRACT;
const titleId = process.env.LEMO_TITLE_ID ?? `0x${"ee".repeat(32)}`;
const artifact = JSON.parse(await readFile(new URL("../artifacts/LemoTitle.json", import.meta.url), "utf8"));
const { publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);

const block = await publicClient.getBlock();
const baseFee = block.baseFeePerGas ?? 0n;
const record = await publicClient.readContract({ address: contract, abi: artifact.abi, functionName: "titles", args: [titleId] });
const currentRevision = BigInt(record[2]);
console.log("current revision:", currentRevision.toString());

try {
  const hash = await walletClient.writeContract({
    address: contract,
    abi: artifact.abi,
    functionName: "set",
    args: [titleId, `0x${"ab".repeat(32)}`, 1000n, currentRevision - 1n, `0x${"11".repeat(32)}`, true],
    gasPrice: baseFee,
    type: "legacy",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log("UNEXPECTED status:", receipt.status, "tx", hash);
  process.exit(1);
} catch (cause) {
  console.log("reverted as expected:", (cause.shortMessage ?? cause.message ?? "error").split("\n")[0]);
}
