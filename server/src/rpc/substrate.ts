import type { JsonRpcClient } from "./jsonRpc.ts";

export type Hex = `0x${string}`;

export type BlockHeader = {
  readonly hash: Hex;
  readonly number: number;
  readonly parentHash: Hex;
  readonly stateRoot: Hex;
};

export type StorageProof = {
  readonly at: Hex;
  readonly nodes: readonly Hex[];
};

type RawHeader = {
  readonly parentHash: Hex;
  readonly number: Hex;
  readonly stateRoot: Hex;
};

/**
 * The Substrate side of Portaldot V3. All storage reads take an explicit block
 * hash so callers cannot accidentally mix a value with a different state root.
 */
export class SubstrateClient {
  readonly #rpc: JsonRpcClient;

  constructor(rpc: JsonRpcClient) {
    this.#rpc = rpc;
  }

  get url(): string {
    return this.#rpc.url;
  }

  async genesisHash(): Promise<Hex> {
    return this.#rpc.call<Hex>("chain_getBlockHash", [0]);
  }

  async finalizedHead(): Promise<Hex> {
    return this.#rpc.call<Hex>("chain_getFinalizedHead");
  }

  async header(hash: Hex): Promise<BlockHeader> {
    const raw = await this.#rpc.call<RawHeader | null>("chain_getHeader", [hash]);

    if (raw === null) {
      throw new Error(`no header at ${hash}`);
    }

    return {
      hash,
      number: Number.parseInt(raw.number, 16),
      parentHash: raw.parentHash,
      stateRoot: raw.stateRoot,
    };
  }

  async blockHash(number: number): Promise<Hex | null> {
    return this.#rpc.call<Hex | null>("chain_getBlockHash", [number]);
  }

  async readProof(keys: readonly Hex[], at: Hex): Promise<StorageProof> {
    const result = await this.#rpc.call<{ at: Hex; proof: Hex[] }>("state_getReadProof", [
      keys,
      at,
    ]);

    return { at: result.at, nodes: result.proof };
  }

  async storage(keys: readonly Hex[], at: Hex): Promise<readonly (Hex | null)[]> {
    const result = await this.#rpc.call<Array<{ block: Hex; changes: Array<[Hex, Hex | null]> }>>(
      "state_queryStorageAt",
      [keys, at],
    );
    const block = result[0];

    if (block === undefined) {
      throw new Error(`no storage batch returned for ${at}`);
    }

    const values = new Map(block.changes.map(([key, value]) => [key.toLowerCase(), value]));

    return keys.map((key) => values.get(key.toLowerCase()) ?? null);
  }

  async systemChain(): Promise<string> {
    return this.#rpc.call<string>("system_chain");
  }

  async systemChainType(): Promise<string> {
    return this.#rpc.call<string>("system_chainType");
  }
}
