// Composition root: config, chain clients, storage, gossip and HTTP, then serve.

import { loadConfig } from "./config.ts";
import { RpcClient } from "./chain/client.ts";
import { PortaldotChain } from "./chain/portaldot.ts";
import { EvmClient } from "./chain/evm.ts";
import { StatementStore } from "./statements/store.ts";
import { ChainService } from "./service.ts";
import { Store } from "./store.ts";
import { HttpServer } from "./http/server.ts";
import { Logger, Metrics } from "./observability/telemetry.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = new Logger({ level: config.logLevel });
  const metrics = new Metrics();

  const chain = new PortaldotChain(new RpcClient({ url: config.rpcUrl, timeoutMs: config.timeoutMs, attempts: 3 }));
  const evm = config.evmRpcUrl === null ? null : new EvmClient({ url: config.evmRpcUrl, timeoutMs: config.timeoutMs });
  const statements = new StatementStore({ url: config.statementsUrl, timeoutMs: config.timeoutMs });

  const service = new ChainService({
    chain,
    store: new Store(config.databasePath),
    config,
    evm,
    statements,
    metrics,
  });

  const identity = await chain.describe();
  const server = new HttpServer({ service, config, metrics, logger });
  const { port } = await server.listen();

  logger.info("listening", {
    url: `http://${config.listenHost}:${port}`,
    chain: identity.name,
    specVersion: identity.specVersion,
    genesis: identity.genesisHash,
    evm: evm === null ? "not configured" : await evm.capabilities(),
    statements: await statements.supported(),
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info("shutting down", { signal });

    server
      .close()
      .then(() => process.exit(0))
      .catch((cause: unknown) => {
        logger.error("shutdown failed", { message: cause instanceof Error ? cause.message : String(cause) });
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

await main();
