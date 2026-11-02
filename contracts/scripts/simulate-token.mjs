// Simulates the token constructor with eth_call so the revert reason is visible, instead of the
// estimate path's "reverted for an unknown reason".

import { readFile } from "node:fs/promises";
import { encodeDeployData } from "viem";
import { clients } from "./lib/chain.mjs";

const artifact = JSON.parse(await readFile(new URL("../artifacts/LemoERC20Lite.json", import.meta.url), "utf8"));
const { account, publicClient } = clients(process.env.LEMO_EVM_SEED);

const registry = process.env.LEMO_CONTRACT ?? "0xc88763FA361669fC5d95c2BDD924b0E2872488bB";
const titleId = `0x${"ee".repeat(32)}`;

const data = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: ["LEMO", titleId, 1000n, registry],
});

console.log("deploy data bytes:", (data.length - 2) / 2);

try {
  const result = await publicClient.call({ account, data });
  console.log("call ok, return data:", (result.data ?? "0x").slice(0, 80));
} catch (cause) {
  console.log("revert:", cause.shortMessage ?? cause.message);
  console.log("details:", cause.details ?? "-");
  console.log("data:", cause.data ?? cause.cause?.data ?? "-");
}

try {
  const gas = await publicClient.estimateGas({ account, data });
  console.log("estimate:", gas.toString());
} catch (cause) {
  console.log("estimate reverted:", cause.shortMessage ?? cause.message);
}
