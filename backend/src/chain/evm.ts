// EVM reads for the market face. Built on plain JSON-RPC so the same client works
// against a node that exposes eth_ methods (Portaldot V3 Test) and reports
// "unavailable" — never zero — against one that does not (Portaldot V3 Live).

export type EvmCapability = { readonly available: true; readonly chainId: number } | { readonly available: false; readonly reason: string };

export type TokenRead =
  | { readonly status: "read"; readonly value: bigint }
  | { readonly status: "unavailable"; readonly reason: string };

export class EvmClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private capability: EvmCapability | null = null;

  constructor(input: { readonly url: string; readonly timeoutMs: number }) {
    this.url = input.url;
    this.timeoutMs = input.timeoutMs;
  }

  async capabilities(): Promise<EvmCapability> {
    if (this.capability !== null) return this.capability;

    try {
      const chainIdHex = await this.call<string>("eth_chainId", []);
      this.capability = { available: true, chainId: Number(BigInt(chainIdHex)) };
    } catch (cause) {
      this.capability = {
        available: false,
        reason: cause instanceof Error ? cause.message : "eth_ namespace is not exposed by this node",
      };
    }
    return this.capability;
  }

  /** totalSupply() of an ERC-20. An address with no code is reported unavailable, never as a zero supply. */
  async totalSupply(contract: string): Promise<TokenRead> {
    const capability = await this.capabilities();
    if (!capability.available) return { status: "unavailable", reason: capability.reason };

    const code = await this.codeSize(contract);
    if (code.status === "unavailable") return code;
    if (code.value === 0n) return { status: "unavailable", reason: `no contract code at ${contract}` };

    try {
      const result = await this.call<string>("eth_call", [{ to: contract, data: "0x18160ddd" }, "latest"]);
      if (result === "0x") return { status: "unavailable", reason: `${contract} returned no data for totalSupply()` };
      return { status: "read", value: BigInt(result) };
    } catch (cause) {
      return { status: "unavailable", reason: cause instanceof Error ? cause.message : "eth_call failed" };
    }
  }

  async codeSize(contract: string): Promise<TokenRead> {
    const capability = await this.capabilities();
    if (!capability.available) return { status: "unavailable", reason: capability.reason };

    try {
      const code = await this.call<string>("eth_getCode", [contract, "latest"]);
      return { status: "read", value: BigInt(Math.floor((code.length - 2) / 2)) };
    } catch (cause) {
      return { status: "unavailable", reason: cause instanceof Error ? cause.message : "eth_getCode failed" };
    }
  }

  private async call<T>(method: string, params: readonly unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`http ${response.status} from ${method}`);

    const body = (await response.json()) as { result?: T; error?: { message?: string } };
    if (body.error !== undefined) throw new Error(body.error.message ?? `${method} failed`);
    if (body.result === undefined) throw new Error(`${method} returned no result`);
    return body.result;
  }
}
