// Deploys one artifact over the EVM path, using the node's own gas estimate (revive gas is
// weight-scaled) and the chain's base fee. Verifies the deployment by reading the code back and
// calling a view function. Writes nothing; prints the address and transaction hash.

import { readFile } from "node:fs/promises";
import { clients } from "./lib/chain.mjs";

const artifact = JSON.parse(
  await readFile(new URL(process.env.LEMO_ARTIFACT ?? "../artifacts/LemoTitle.json", import.meta.url), "utf8"),
);

const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);

const block = await publicClient.getBlock();
const baseFee = block.baseFeePerGas ?? 0n;
const estimate = await publicClient.estimateGas({ account, data: artifact.bytecode, value: 0n });
const gas = (estimate * 12n) / 10n;

console.log("contract  ", artifact.contractName);
console.log("deployer  ", account.address);
console.log("balance   ", (Number(await publicClient.getBalance({ address: account.address })) / 1e18).toFixed(3), "POT");
console.log("gas       ", gas.toString(), "at base fee", baseFee.toString(), "wei");
console.log("max cost  ", ((Number(gas * baseFee)) / 1e18).toFixed(3), "POT");

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [],
  gas,
  gasPrice: baseFee,
  type: "legacy",
});

console.log("sent      ", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
console.log("status    ", receipt.status, "| block", receipt.blockNumber, "| gasUsed", receipt.gasUsed.toString());
console.log("address   ", receipt.contractAddress);

if (receipt.status !== "success" || receipt.contractAddress === null) {
  console.log("deployment did not succeed");
  process.exit(1);
}

const code = await publicClient.getCode({ address: receipt.contractAddress });
console.log("code bytes", (code ?? "0x").length / 2 - 1);

const governor = await publicClient.readContract({
  address: receipt.contractAddress,
  abi: artifact.abi,
  functionName: "governor",
});
console.log("governor  ", governor);
console.log("same as deployer:", String(governor).toLowerCase() === account.address.toLowerCase());
