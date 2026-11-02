// Reads the settled title back from the deployed contract through its ABI.

import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";

const abi = JSON.parse(
  await readFile(new URL("../artifacts/LemoTitle.json", import.meta.url), "utf8"),
).abi;

const client = createPublicClient({ transport: http("https://test-evm-rpc-v3.portaldot.dev") });
const address = process.env.LEMO_CONTRACT ?? "0xc88763FA361669fC5d95c2BDD924b0E2872488bB";
const titleId = `0x${"ee".repeat(32)}`;

const record = await client.readContract({ address, abi, functionName: "titles", args: [titleId] });
const eligible = await client.readContract({ address, abi, functionName: "eligible", args: [titleId] });

console.log("contract:", address);
console.log("record:", JSON.stringify(record, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
console.log("eligible:", eligible);
