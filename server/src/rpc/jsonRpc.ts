export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export type JsonRpcOptions = {
  readonly url: string;
  readonly timeoutMs: number;
};

type JsonRpcResponse = {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
};

/**
 * A JSON-RPC 2.0 client. Every request is bounded by a timeout so a stalled
 * endpoint fails the calling request instead of holding it open.
 */
export class JsonRpcClient {
  readonly #url: string;
  readonly #timeoutMs: number;
  #nextId = 1;

  constructor(options: JsonRpcOptions) {
    this.#url = options.url;
    this.#timeoutMs = options.timeoutMs;
  }

  get url(): string {
    return this.#url;
  }

  async call<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    const id = this.#nextId++;
    const response = await fetch(this.#url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!response.ok) {
      throw new RpcError(-32000, `${method}: HTTP ${response.status} from ${this.#url}`);
    }

    const payload = (await response.json()) as JsonRpcResponse;

    if (payload.error !== undefined) {
      throw new RpcError(
        payload.error.code ?? -32000,
        payload.error.message ?? `${method} failed`,
        payload.error.data,
      );
    }

    if (!("result" in payload)) {
      throw new RpcError(-32603, `${method}: response carried no result`);
    }

    return payload.result as T;
  }
}
