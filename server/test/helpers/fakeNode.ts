import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { proofByKey, type Fixture } from "./fixture.ts";

/**
 * A stand-in node for HTTP-level tests.
 *
 * It serves the REAL captured fixture: the request/response plumbing is faked,
 * the proof bytes and storage values are not. Nothing here invents a witness.
 */

export type FakeNodeOptions = {
  readonly fixture: Fixture;
  readonly genesisHash?: string;
  readonly ethChainId?: number;
  /** The public V3 endpoint answers `Method not found`; this mirrors it. */
  readonly ethGetProof?: boolean;
  /** Reports the finalized head this many blocks ahead of the captured block. */
  readonly finalizedAheadBy?: number;
  /** Lets a test damage or prune the node set on the way out. */
  readonly mutateProof?: (nodes: string[]) => string[];
};

export type FakeNode = {
  readonly substrateUrl: string;
  readonly evmUrl: string;
  readonly calls: readonly string[];
  close(): Promise<void>;
};

type JsonRpcRequest = {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown[];
};

const SYNTHETIC_HASH = `0x${"ab".repeat(32)}`;

export async function startFakeNode(options: FakeNodeOptions): Promise<FakeNode> {
  const fixture = options.fixture;
  const genesisHash = options.genesisHash ?? fixture.network.genesisHash;
  const ethChainId = options.ethChainId ?? fixture.network.evmChainId;
  const finalizedAhead = options.finalizedAheadBy ?? 0;
  const finalizedHash = finalizedAhead > 0 ? SYNTHETIC_HASH : fixture.block.hash;
  const finalizedNumber = fixture.block.number + finalizedAhead;
  const calls: string[] = [];

  const headerFor = (hash: string): Record<string, string> | null => {
    const lower = hash.toLowerCase();

    if (lower === fixture.block.hash.toLowerCase()) {
      return {
        parentHash: fixture.block.parentHash,
        number: `0x${fixture.block.number.toString(16)}`,
        stateRoot: fixture.block.stateRoot,
      };
    }

    if (lower === finalizedHash.toLowerCase()) {
      return {
        parentHash: fixture.block.hash,
        number: `0x${finalizedNumber.toString(16)}`,
        stateRoot: fixture.block.stateRoot,
      };
    }

    return null;
  };

  const substrate = (request: JsonRpcRequest): unknown => {
    const method = request.method ?? "";
    const params = request.params ?? [];

    switch (method) {
      case "chain_getBlockHash": {
        const first = params[0];

        if (first === undefined) {
          return fixture.block.hash;
        }

        if (first === 0) {
          return genesisHash;
        }

        if (first === fixture.block.number) {
          return fixture.block.hash;
        }

        if (first === finalizedNumber) {
          return finalizedHash;
        }

        return null;
      }
      case "chain_getFinalizedHead":
        return finalizedHash;
      case "chain_getHeader": {
        const hash = params[0];

        if (typeof hash !== "string") {
          return null;
        }

        return headerFor(hash);
      }
      case "state_getReadProof": {
        const keys = params[0];
        const at = params[1];
        const key = Array.isArray(keys) ? String(keys[0]) : "";
        const entry = proofByKey(fixture, key);

        if (entry === undefined) {
          return { at: typeof at === "string" ? at : fixture.block.hash, proof: [] };
        }

        const nodes = [...entry.proof];
        return {
          at: typeof at === "string" ? at : fixture.block.hash,
          proof: options.mutateProof === undefined ? nodes : options.mutateProof(nodes),
        };
      }
      case "state_getStorage": {
        const key = params[0];
        const entry = typeof key === "string" ? proofByKey(fixture, key) : undefined;
        return entry?.storage ?? null;
      }
      case "system_chain":
        return fixture.network.chain;
      case "system_chainType":
        return fixture.network.chainType;
      case "system_version":
        return "portaldot-v3-test/fake";
      case "rpc_methods":
        return {
          methods: [
            "chain_getBlockHash",
            "chain_getFinalizedHead",
            "chain_getHeader",
            "state_getReadProof",
            "state_getStorage",
            "system_chain",
            "system_chainType",
            "system_version",
            "rpc_methods",
          ],
        };
      default:
        throw new MethodNotFound(method);
    }
  };

  const evm = (request: JsonRpcRequest): unknown => {
    const method = request.method ?? "";

    switch (method) {
      case "eth_chainId":
        return `0x${ethChainId.toString(16)}`;
      case "eth_blockNumber":
        return `0x${fixture.block.number.toString(16)}`;
      case "eth_getBlockByNumber":
        return {
          number: `0x${fixture.block.number.toString(16)}`,
          hash: fixture.block.hash,
          parentHash: fixture.block.parentHash,
          stateRoot: fixture.block.stateRoot,
          timestamp: "0x0",
        };
      case "eth_getProof":
        if (options.ethGetProof !== true) {
          throw new MethodNotFound(method);
        }

        return {
          address: "0x0000000000000000000000000000000000000000",
          accountProof: [fixture.proofs.systemNumber.proof[0] ?? "0x00"],
          balance: "0x0",
          codeHash: fixture.block.stateRoot,
          nonce: "0x0",
          storageHash: fixture.block.stateRoot,
          storageProof: [],
        };
      default:
        throw new MethodNotFound(method);
    }
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let request: JsonRpcRequest;

      try {
        request = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.statusCode = 400;
        res.end("not json");
        return;
      }

      calls.push(request.method ?? "");

      const isEvm = (req.url ?? "").startsWith("/evm");

      try {
        const result = isEvm ? evm(request) : substrate(request);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id ?? 1, result }));
      } catch (error) {
        const code = error instanceof MethodNotFound ? -32601 : -32000;
        const message = error instanceof Error ? error.message : "node failure";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id ?? 1, error: { code, message } }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  return {
    substrateUrl: `${base}/substrate`,
    evmUrl: `${base}/evm`,
    calls,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

class MethodNotFound extends Error {
  constructor(method: string) {
    super(`Method not found: ${method}`);
    this.name = "MethodNotFound";
  }
}
