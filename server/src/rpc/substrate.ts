import type { JsonRpcClient, RpcStats } from "./jsonRpc.ts";

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
 * The Substrate side of Portaldot V3.
 *
 * Every storage read takes an explicit block hash. Reading "latest" and then
 * fetching a proof at another hash is how a service ends up serving a value
 * proved against a root it no longer believes.
 */
export class SubstrateClient {
  readonly #rpc: JsonRpcClient;

  constructor(rpc: JsonRpcClient) {
    this.#rpc = rpc;
  }

  get url(): string {
    return this.#rpc.url;
  }

  get stats(): RpcStats {
    return this.#rpc.stats;
  }

  async genesisHash(): Promise<Hex> {
    return this.#rpc.call<Hex>("chain_getBlockHash", [0]);
  }

  async finalizedHash(): Promise<Hex> {
    return this.#rpc.call<Hex>("chain_getFinalizedHead");
  }

  async bestHash(): Promise<Hex> {
    const hash = await this.#rpc.call<Hex | null>("chain_getBlockHash");

    if (hash === null) {
      throw new Error("the node reported no best block hash");
    }

    return hash;
  }

  async header(hash: Hex): Promise<BlockHeader> {
    const raw = await this.#rpc.call<RawHeader | null>("chain_getHeader", [hash]);

    if (raw === null || raw === undefined) {
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

  /** One storage value at an explicit block. `null` means the key is absent. */
  async storageOne(key: Hex, at: Hex): Promise<Hex | null> {
    return this.#rpc.call<Hex | null>("state_getStorage", [key, at]);
  }

  /** The trie hash of a storage value, the node's own second opinion. */
  async storageHash(key: Hex, at: Hex): Promise<Hex | null> {
    return this.#rpc.call<Hex | null>("state_getStorageHash", [key, at]);
  }

  /** Storage keys under a prefix at an explicit block. Used for fixture capture. */
  async keysPaged(prefix: Hex, count: number, at: Hex): Promise<Hex[]> {
    return this.#rpc.call<Hex[]>("state_getKeysPaged", [prefix, count, null, at]);
  }

  async systemChain(): Promise<string> {
    return this.#rpc.call<string>("system_chain");
  }

  async systemChainType(): Promise<string> {
    return this.#rpc.call<string>("system_chainType");
  }

  async systemVersion(): Promise<string> {
    return this.#rpc.call<string>("system_version");
  }

  async rpcMethods(): Promise<readonly string[]> {
    const result = await this.#rpc.call<{ methods?: string[] }>("rpc_methods");
    return result.methods ?? [];
  }
}
