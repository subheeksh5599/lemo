// Chain definition and clients for Portaldot V3 Test (revive). Legacy transactions only:
// pallet-revive accepts EIP-155 legacy payloads, and a pinned gasPrice keeps the type stable.

import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export const PORTALDOT_TEST = defineChain({
  id: Number(process.env.LEMO_EVM_CHAIN_ID ?? 420420777),
  name: "Portaldot V3 Test",
  nativeCurrency: { name: "POT", symbol: "POT", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.LEMO_EVM_RPC_URL ?? "https://test-evm-rpc-v3.portaldot.dev"] },
  },
});

export function clients(mnemonic) {
  if (!mnemonic) throw new Error("LEMO_EVM_SEED is not set");

  const account = mnemonicToAccount(mnemonic.trim(), { path: "m/44'/60'/0'/0/0" });
  const transport = http(PORTALDOT_TEST.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 3 });

  return {
    account,
    publicClient: createPublicClient({ chain: PORTALDOT_TEST, transport }),
    walletClient: createWalletClient({ account, chain: PORTALDOT_TEST, transport }),
  };
}

export function explorer(chainId = PORTALDOT_TEST.id) {
  return `chain ${chainId}`;
}
