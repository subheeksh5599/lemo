// Re-derives the deployed contract address from the deployer's first nonce (CREATE), so the
// address in the docs comes from the chain rather than from a copy-paste.

import { createPublicClient, getContractAddress, http } from "viem";

const client = createPublicClient({ transport: http("https://test-evm-rpc-v3.portaldot.dev") });
const deployer = process.env.LEMO_DEPLOYER ?? "0x09110714Ea97feaBCf0CAe2dcb1Be6Da69ABcDfA";

for (let nonce = 0n; nonce < 5n; nonce += 1n) {
  const address = getContractAddress({ from: deployer, nonce });
  const code = await client.getCode({ address });
  const size = ((code ?? "0x").length - 2) / 2;
  console.log(`nonce ${nonce} -> ${address} | code ${size} bytes`);
}
