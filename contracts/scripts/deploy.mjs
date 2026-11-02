// Deploys the two LEMO contracts to Portaldot V3 Test and records the addresses.
// The seed is read from LEMO_EVM_SEED for this process only; nothing is written to disk but
// the public addresses and transaction hashes in deployments.json.

import { readFile, writeFile } from "node:fs/promises";
import { clients, PORTALDOT_TEST } from "./lib/chain.mjs";

const artifact = async (name) =>
  JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), "utf8"));

const log = (...parts) => console.log(...parts);

async function main() {
  const { account, publicClient, walletClient } = clients(process.env.LEMO_EVM_SEED);
  const chainId = await publicClient.getChainId();
  if (chainId !== PORTALDOT_TEST.id) throw new Error(`this script targets chain ${PORTALDOT_TEST.id}, node reports ${chainId}`);

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? 0n;
  const gasPrice = baseFee * 2n > 0n ? baseFee * 2n : (await publicClient.getGasPrice()) * 2n;
  const balance = await publicClient.getBalance({ address: account.address });
  log(`deployer ${account.address} on chain ${chainId}`);
  log(`balance ${balance} wei, gasPrice ${gasPrice} wei`);

  const registryArtifact = await artifact("LemoTitleRegistry");
  const registryHash = await walletClient
    .deployContract({
      abi: registryArtifact.abi,
      bytecode: registryArtifact.bytecode,
      args: [],
      gas: 4_000_000n,
      gasPrice,
    })
    .catch((cause) => {
      log("deploy failed:", cause.shortMessage ?? cause.message);
      log("details:", cause.details ?? "-");
      log("cause:", cause.cause?.message ?? "-");
      throw cause;
    });
  const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryHash, timeout: 120_000 });
  if (registryReceipt.status !== "success") throw new Error(`registry deployment failed: ${registryHash}`);
  log(`registry  ${registryReceipt.contractAddress}  tx ${registryHash}`);

  const tokenArtifact = await artifact("LemoERC20");
  const titleId = process.env.LEMO_TITLE_ID ?? `0x${"ee".repeat(32)}`;
  const backingCap = BigInt(process.env.LEMO_BACKING_CAP ?? 1000);

  const tokenHash = await walletClient.deployContract({
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode,
    args: ["LEMO Wrapped Asset", "LEMO", titleId, backingCap, registryReceipt.contractAddress],
    gas: 4_000_000n,
    gasPrice,
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash, timeout: 120_000 });
  if (tokenReceipt.status !== "success") throw new Error(`token deployment failed: ${tokenHash}`);
  log(`token     ${tokenReceipt.contractAddress}  tx ${tokenHash}`);

  const deployment = {
    chainId,
    chainName: PORTALDOT_TEST.name,
    deployer: account.address,
    titleId,
    backingCap: backingCap.toString(),
    registry: { address: registryReceipt.contractAddress, tx: registryHash, block: registryReceipt.blockNumber },
    token: { address: tokenReceipt.contractAddress, tx: tokenHash, block: tokenReceipt.blockNumber },
    deployedAt: new Date().toISOString(),
  };

  await writeFile(new URL("../deployments.json", import.meta.url), JSON.stringify(deployment, null, 2));
  log("wrote contracts/deployments.json");
}

await main();
