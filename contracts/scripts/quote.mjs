// Quotes the EVM-path deployment of one artifact: gas estimate, fee at base fee, code deposit.
// Nothing is submitted.

import { readFile } from "node:fs/promises";
import { clients } from "./lib/chain.mjs";

const artifactPath = process.env.LEMO_ARTIFACT ?? "../artifacts/LemoTitle.json";
const artifact = JSON.parse(await readFile(new URL(artifactPath, import.meta.url), "utf8"));

const seed = process.env.LEMO_EVM_SEED;
const { account, publicClient } = clients(seed);

const block = await publicClient.getBlock();
const baseFee = block.baseFeePerGas ?? 0n;
const bytes = (artifact.bytecode.length - 2) / 2;

const estimate = await publicClient.estimateGas({ account, data: artifact.bytecode, value: 0n });
const gas20 = (estimate * 12n) / 10n;
const fee = gas20 * baseFee;
const deposit = BigInt(Math.ceil(0.06 * bytes)) * 10n ** 14n;

const pot = (value) => (Number(value) / 1e18).toFixed(4);

console.log(`contract     ${artifact.contractName} (${bytes} bytes)`);
console.log(`deployer     ${account.address}`);
console.log(`balance      ${pot(await publicClient.getBalance({ address: account.address }))} POT (evm side)`);
console.log(`base fee     ${baseFee} wei`);
console.log(`gas estimate ${estimate}`);
console.log(`gas at 1.2x  ${gas20}  -> fee ${pot(fee)} POT`);
console.log(`code deposit ${pot(deposit)} POT`);
console.log(`total        ${pot(fee + deposit)} POT`);
