// The Portaldot V3 methods this service uses, typed at the boundary so the rest of
// the code never handles raw hex headers.

import { bytes } from "../bytes.ts";
import type { RpcClient } from "./client.ts";

export type Header = {
  readonly number: number;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
};

type RawHeader = { number: string; parentHash: string; stateRoot: string };

export type ChainIdentity = {
  readonly name: string;
  readonly genesisHash: string;
  readonly specVersion: number;
};

export class PortaldotChain {
  private readonly client: RpcClient;
  private identity: ChainIdentity | null = null;

  constructor(client: RpcClient) {
    this.client = client;
  }

  async describe(): Promise<ChainIdentity> {
    if (this.identity !== null) return this.identity;

    const [name, genesisHash, version] = await Promise.all([
      this.client.call<string>("system_chain", []),
      this.client.call<string>("chain_getBlockHash", [0]),
      this.client.call<{ specVersion: number }>("state_getRuntimeVersion", []),
    ]);

    this.identity = { name, genesisHash, specVersion: version.specVersion };
    return this.identity;
  }

  async finalizedHead(): Promise<Header> {
    const hash = await this.client.call<string>("chain_getFinalizedHead", []);
    return this.header(hash);
  }

  async headNumber(): Promise<number> {
    const header = await this.client.call<RawHeader>("chain_getHeader", []);
    return Number.parseInt(header.number, 16);
  }

  async header(hash: string): Promise<Header> {
    const raw = await this.client.call<RawHeader | null>("chain_getHeader", [hash]);
    if (raw === null) throw new Error(`header ${hash} is unknown to the node`);

    return {
      number: Number.parseInt(raw.number, 16),
      hash,
      parentHash: raw.parentHash,
      stateRoot: raw.stateRoot,
    };
  }

  async readProof(keys: readonly string[], at: string): Promise<{ at: string; nodes: Uint8Array[] }> {
    const result = await this.client.call<{ at: string; proof: string[] }>("state_getReadProof", [keys, at]);
    return { at: result.at, nodes: result.proof.map((node) => bytes.fromHex(node)) };
  }

  async keysWithPrefix(prefix: string, count: number, at: string): Promise<string[]> {
    return this.client.call<string[]>("state_getKeysPaged", [prefix, count, null, at]);
  }

  async storage(key: string, at: string): Promise<string | null> {
    return this.client.call<string | null>("state_getStorage", [key, at]);
  }
}
