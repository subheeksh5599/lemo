// Third probe: use the node's own gas estimate (revive gas units are weight-scaled, far above
// the EVM numbers a normal chain reports) and see whether the pool accepts the transaction.

import { clients } from "./lib/chain.mjs";

const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);
const latest = await publicClient.getBlock();
const baseFee = latest.baseFeePerGas ?? 0n;

const estimate = await publicClient.estimateGas({ account, to: account.address, value: 1n });
console.log(`transfer estimate ${estimate} gas | baseFee ${baseFee} | cost ${estimate * (baseFee * 2n)} wei`);

async function tryIt(label, send) {
  try {
    const hash = await send();
    console.log(`${label}: sent ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
    console.log(receipt === null ? "  no receipt" : `  status ${receipt.status} block ${receipt.blockNumber} gasUsed ${receipt.gasUsed}`);
    return receipt;
  } catch (cause) {
    console.log(`${label}: REJECTED — ${cause.shortMessage ?? cause.message} | ${cause.details ?? ""}`);
    return null;
  }
}

await tryIt("transfer at estimated gas", () =>
  walletClient.sendTransaction({
    to: account.address,
    value: 1n,
    gas: estimate,
    gasPrice: baseFee * 2n,
    type: "legacy",
  }),
);

await tryIt("transfer at 10x estimate", () =>
  walletClient.sendTransaction({
    to: account.address,
    value: 1n,
    gas: estimate * 10n,
    gasPrice: baseFee * 2n,
    type: "legacy",
  }),
);
