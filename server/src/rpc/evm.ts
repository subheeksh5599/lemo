import type { JsonRpcClient, RpcStats } from "./jsonRpc.ts";
import type { Hex } from "./substrate.ts";

export type EvmBlock = {
  readonly number: number;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly stateRoot: Hex;
  readonly timestamp: bigint;
};

type RawEvmBlock = {
  readonly number: Hex;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly stateRoot: Hex;
  readonly timestamp: Hex;
};

export type EvmAccountProof = {
  readonly address: Hex;
  readonly accountProof: readonly Hex[];
  readonly balance: Hex;
  readonly codeHash: Hex;
  readonly nonce: Hex;
  readonly storageHash: Hex;
  readonly storageProof: readonly {
    readonly key: Hex;
    readonly value: Hex;
    readonly proof: readonly Hex[];
  }[];
};

/**
 * The Revive (EVM) side of Portaldot V3.
 *
 * Every read takes an explicit block tag so a value can be tied to a block a
 * caller already proved. `eth_getProof` is carried here as a plain transport:
 * whether the node supports it is a policy question answered by the service,
 * not something this client papers over.
 */
export class EvmClient {
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

  async chainId(): Promise<number> {
    return Number(BigInt(await this.#rpc.call<Hex>("eth_chainId")));
  }

  async blockNumber(): Promise<number> {
    return Number(BigInt(await this.#rpc.call<Hex>("eth_blockNumber")));
  }

  async block(tag: "latest" | "finalized" | Hex | number): Promise<EvmBlock> {
    const blockTag = typeof tag === "number" ? `0x${tag.toString(16)}` : tag;
    const raw = await this.#rpc.call<RawEvmBlock | null>("eth_getBlockByNumber", [blockTag, false]);

    if (raw === null || raw === undefined) {
      throw new Error(`no EVM block at ${String(tag)}`);
    }

    return {
      number: Number(BigInt(raw.number)),
      hash: raw.hash,
      parentHash: raw.parentHash,
      stateRoot: raw.stateRoot,
      timestamp: BigInt(raw.timestamp),
    };
  }

  async storageAt(address: Hex, slot: Hex, tag: "latest" | "finalized" | Hex): Promise<Hex> {
    return this.#rpc.call<Hex>("eth_getStorageAt", [address, slot, tag]);
  }

  async codeAt(address: Hex, tag: "latest" | "finalized" | Hex): Promise<Hex> {
    return this.#rpc.call<Hex>("eth_getCode", [address, tag]);
  }

  async call(request: { to: Hex; data: Hex }, tag: "latest" | "finalized" | Hex): Promise<Hex> {
    return this.#rpc.call<Hex>("eth_call", [{ to: request.to, data: request.data }, tag]);
  }

  /**
   * `eth_getProof` at a block tag. Throws `RpcError` with the node's own code
   * and message when the method is missing; callers must report that refusal
   * rather than synthesising a witness.
   */
  async accountProof(
    address: Hex,
    slots: readonly Hex[],
    tag: "latest" | "finalized" | Hex,
  ): Promise<EvmAccountProof> {
    return this.#rpc.call<EvmAccountProof>("eth_getProof", [address, [...slots], tag]);
  }
}
