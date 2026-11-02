// Probes which transaction shape pallet-revive accepts: plain transfers at two gas limits, then a
// contract deployment at two gas limits. Every rejection is printed verbatim.

import { readFile } from "node:fs/promises";
import { clients } from "./lib/chain.mjs";

const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);
const latest = await publicClient.getBlock();
const gasPrice = (latest.baseFeePerGas ?? 0n) * 2n || 1_000_000_000n;

console.log(`deployer ${account.address}`);
console.log(`nonce ${await publicClient.getTransactionCount({ address: account.address })} | gasPrice ${gasPrice} | blockGasLimit ${latest.gasLimit}`);

async function tryIt(label, send) {
  try {
    const hash = await send();
    console.log(`${label}: sent ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 }).catch(() => null);
    if (receipt === null) {
      console.log("  no receipt within 90s");
      return null;
    }
    console.log(`  status ${receipt.status} block ${receipt.blockNumber} contract ${receipt.contractAddress ?? "-"}`);
    return receipt;
  } catch (cause) {
    console.log(`${label}: REJECTED — ${cause.shortMessage ?? cause.message} | ${cause.details ?? ""}`);
    return null;
  }
}

await tryIt("transfer gas=21000", () =>
  walletClient.sendTransaction({ to: account.address, value: 0n, gas: 21_000n, gasPrice, type: "legacy" }),
);

await tryIt("transfer gas=200000", () =>
  walletClient.sendTransaction({ to: account.address, value: 0n, gas: 200_000n, gasPrice, type: "legacy" }),
);

const artifact = JSON.parse(await readFile(new URL("../artifacts/LemoTitleRegistry.json", import.meta.url), "utf8"));

await tryIt("deploy gas=1e6", () =>
  walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [],
    gas: 1_000_000n,
    gasPrice,
    type: "legacy",
  }),
);

await tryIt("deploy gas=3e6", () =>
  walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [],
    gas: 3_000_000n,
    gasPrice,
    type: "legacy",
  }),
);
