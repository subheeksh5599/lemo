// Verifies the testnet transaction hashes recorded in the deployment notes by fetching each
// receipt from the chain and printing what it actually did.

const RPC = "https://test-evm-rpc-v3.portaldot.dev";

const hashes = [
  "0xb65d70260e5f7c53540a7ba7f9cb6488760f99f638096a557e7e8f554e6987eb",
  "0x8bf6072c6a9fc191da973d5e5650dc86c006b042e6461293cd3961d4c9a8d38f",
  "0x2f6ec1cfed2e140a16b320e5b7f8349db6db5c3bbe0c3477357fc65db00aeae6",
  "0xebd226c25ae0f183608a1197d8cfe5897384a6b5e69b04c8a97b5bec4d0e66e9",
];

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

for (const hash of hashes) {
  const receipt = await rpc("eth_getTransactionReceipt", [hash]);
  if (receipt === null) {
    console.log(`${hash}: no receipt`);
    continue;
  }
  console.log(
    `${hash.slice(0, 12)}… status ${parseInt(receipt.status, 16)} block ${parseInt(receipt.blockNumber, 16)} to ${receipt.to ?? "(create)"} contract ${receipt.contractAddress ?? "-"}`,
  );
}
