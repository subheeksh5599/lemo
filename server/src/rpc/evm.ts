import type { JsonRpcClient } from "./jsonRpc.ts";
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

/**
 * The Revive (EVM) side of Portaldot V3. Values are read at an explicit block
 * tag so they can be tied to the block a caller already proved.
 */
export class EvmClient {
  readonly #rpc: JsonRpcClient;

  constructor(rpc: JsonRpcClient) {
    this.#rpc = rpc;
  }

  get url(): string {
    return this.#rpc.url;
  }

  async chainId(): Promise<number> {
    return Number(BigInt(await this.#rpc.call<Hex>("eth_chainId")));
  }

  async blockNumber(): Promise<number> {
    return Number(BigInt(await this.#rpc.call<Hex>("eth_blockNumber")));
  }

  async block(tag: "latest" | "finalized" | `0x${string}` | number): Promise<EvmBlock> {
    const blockTag = typeof tag === "number" ? `0x${tag.toString(16)}` : tag;
    const raw = await this.#rpc.call<RawEvmBlock | null>("eth_getBlockByNumber", [blockTag, false]);

    if (raw === null) {
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
}
