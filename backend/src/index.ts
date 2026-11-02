// Entry point: wire configuration, RPC, storage and HTTP, then serve.

import { loadConfig } from "./config.ts";
import { PortaldotChain } from "./chain/portaldot.ts";
import { RpcClient } from "./chain/client.ts";
import { ChainService } from "./service.ts";
import { Store } from "./store.ts";
import { HttpServer } from "./http/server.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const chain = new PortaldotChain(
    new RpcClient({ url: config.rpcUrl, timeoutMs: config.rpcTimeoutMs, attempts: config.rpcAttempts }),
  );
  const store = new Store(config.databasePath);
  const service = new ChainService({ chain, store, config });

  const identity = await chain.describe();
  const server = new HttpServer({ service, config });
  const { port } = await server.listen();

  console.log(`listening on http://127.0.0.1:${port}`);
  console.log(`chain ${identity.name} spec ${identity.specVersion} genesis ${identity.genesisHash}`);

  const shutdown = (): void => {
    server
      .close()
      .then(() => process.exit(0))
      .catch((cause: unknown) => {
        console.error(cause);
        process.exit(1);
      });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await main();
