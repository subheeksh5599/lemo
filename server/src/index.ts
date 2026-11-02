import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { EvmClient } from "./rpc/evm.ts";
import { JsonRpcClient } from "./rpc/jsonRpc.ts";
import { SubstrateClient } from "./rpc/substrate.ts";
import { ProofService } from "./service.ts";

/**
 * Entrypoint.
 *
 * Order matters: configuration is validated, then the live chain is checked
 * against it, and only then does the process bind a port. A service that will
 * serve proofs about the wrong chain should never reach `listen`.
 */

const config = loadConfig();

const substrate = new SubstrateClient(
  new JsonRpcClient({ url: config.substrate.url, timeoutMs: config.rpcTimeoutMs }),
);
const evm = new EvmClient(
  new JsonRpcClient({ url: config.evm.url, timeoutMs: config.rpcTimeoutMs }),
);
const service = new ProofService({ config, substrate, evm });

const app = await buildApp({ config, service });

let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) {
    return;
  }

  closing = true;
  app.log.info({ signal }, "signal received, shutting down");

  const timer = setTimeout(() => {
    app.log.error("graceful shutdown timed out after 10s");
    process.exit(1);
  }, 10_000);

  timer.unref();

  try {
    await app.close();
    app.log.info("http server closed");
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  const identity = await service.startupCheck();
  app.log.info(
    {
      chain: identity.chain,
      chainType: identity.chainType,
      genesisHash: identity.genesisHash,
      evmChainId: identity.evmChainId,
      finalizedHash: identity.finalizedHash,
    },
    "startup validation passed: live chain matches configuration",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  app.log.fatal({ err: error }, `startup validation failed: ${message}`);
  console.error(`lemo proof service refused to start: ${message}`);
  await app.close();
  process.exit(1);
}

await app.listen({ host: config.host, port: config.port });

const bound = app.server.address();
const boundAddress =
  typeof bound === "object" && bound !== null ? `${bound.address}:${bound.port}` : String(bound);

app.log.info(
  {
    boundAddress,
    substrate: config.substrate.url,
    evm: config.evm.url,
    endpoints: [
      "GET /healthz",
      "GET /v1/network",
      "GET /v1/witness/native",
      "POST /v1/verify/native",
      "GET /v1/witness/evm",
      "GET /v1/reads",
    ],
  },
  `lemo proof service listening on ${boundAddress}`,
);
