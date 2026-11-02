// Deploys the ERC-20 representation, wired to the deployed LemoTitle registry, then mints against
// the cap and proves the transfer gate both ways (eligible → moves, frozen → reverts).

import { readFile } from "node:fs/promises";
import { encodeDeployData } from "viem";
import { clients } from "./lib/chain.mjs";

const artifact = JSON.parse(await readFile(new URL("../artifacts/LemoERC20Lite.json", import.meta.url), "utf8"));
const tokenAbi = artifact.abi;

const registry = process.env.LEMO_CONTRACT ?? "0xc88763FA361669fC5d95c2BDD924b0E2872488bB";
const titleId = `0x${"ee".repeat(32)}`;
const cap = BigInt(process.env.LEMO_CAP ?? 1000);
const symbol = process.env.LEMO_SYMBOL ?? "LEMO";

const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);
const block = await publicClient.getBlock();
const baseFee = block.baseFeePerGas ?? 0n;

const deployData = encodeDeployData({ abi: tokenAbi, bytecode: artifact.bytecode, args: [symbol, titleId, cap, registry] });
const estimate = await publicClient.estimateGas({ account, data: deployData, value: 0n });
const gas = (estimate * 12n) / 10n;
const balance = await publicClient.getBalance({ address: account.address });

console.log("deployer:", account.address);
console.log("balance :", (Number(balance) / 1e18).toFixed(3), "POT");
console.log("gas     :", gas.toString(), "-> max fee", (Number(gas * baseFee) / 1e18).toFixed(3), "POT");

if (balance < gas * baseFee) {
  console.log("evm balance is short of the fee; fund this address first");
  process.exit(1);
}

const hash = await walletClient.deployContract({
  abi: tokenAbi,
  bytecode: artifact.bytecode,
  args: [symbol, titleId, cap, registry],
  gas,
  gasPrice: baseFee,
  type: "legacy",
});

console.log("sent    :", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
console.log("status  :", receipt.status, "| block", receipt.blockNumber, "| gasUsed", receipt.gasUsed.toString());

if (receipt.status !== "success" || receipt.contractAddress === null) {
  console.log("deployment failed");
  process.exit(1);
}

const token = receipt.contractAddress;
console.log("token   :", token);

const read = (functionName, args = []) =>
  publicClient.readContract({ address: token, abi: tokenAbi, functionName, args });

async function send(functionName, args) {
  const txHash = await walletClient.writeContract({
    address: token,
    abi: tokenAbi,
    functionName,
    args,
    gasPrice: baseFee,
    type: "legacy",
  });
  const sent = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
  return { status: sent.status, gasUsed: sent.gasUsed.toString(), hash: txHash };
}

console.log("symbol  :", await read("symbol"), "| decimals", String(await read("decimals")), "| cap", String(await read("cap")));

console.log("mint    :", JSON.stringify(await send("mint", [account.address, cap])));
console.log("supply  :", String(await read("totalSupply")), "| balance", String(await read("balanceOf", [account.address])));

const overMint = await send("mint", [account.address, 1n]).catch((cause) => ({
  status: `reverted: ${(cause.shortMessage ?? cause.message ?? "").split("\n")[0]}`,
}));
console.log("over-mint:", JSON.stringify(overMint));

console.log("transfer:", JSON.stringify(await send("transfer", ["0x000000000000000000000000000000000000beef", 10n])));

console.log("deployer final balance:", (Number(await publicClient.getBalance({ address: account.address })) / 1e18).toFixed(3), "POT");
