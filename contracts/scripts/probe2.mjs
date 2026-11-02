// Second probe: EIP-1559 shape and a non-zero value transfer, to find the transaction form
// pallet-revive accepts. Prints each rejection verbatim.

import { clients } from "./lib/chain.mjs";

const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);
const latest = await publicClient.getBlock();
const baseFee = latest.baseFeePerGas ?? 0n;

console.log(`deployer ${account.address} | baseFee ${baseFee} | balance ${await publicClient.getBalance({ address: account.address })}`);

async function tryIt(label, send) {
  try {
    const hash = await send();
    console.log(`${label}: sent ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
    console.log(receipt === null ? "  no receipt" : `  status ${receipt.status} block ${receipt.blockNumber}`);
    return receipt;
  } catch (cause) {
    console.log(`${label}: REJECTED — ${cause.shortMessage ?? cause.message} | ${cause.details ?? ""}`);
    return null;
  }
}

await tryIt("eip1559 value=0", () =>
  walletClient.sendTransaction({
    to: account.address,
    value: 0n,
    gas: 21_000n,
    maxFeePerGas: baseFee * 2n,
    maxPriorityFeePerGas: 0n,
    type: "eip1559",
  }),
);

await tryIt("eip1559 value=1", () =>
  walletClient.sendTransaction({
    to: account.address,
    value: 1n,
    gas: 21_000n,
    maxFeePerGas: baseFee * 2n,
    maxPriorityFeePerGas: 0n,
    type: "eip1559",
  }),
);

await tryIt("legacy value=1", () =>
  walletClient.sendTransaction({ to: account.address, value: 1n, gas: 21_000n, gasPrice: baseFee * 2n, type: "legacy" }),
);

console.log("pending nonce:", await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }));
