// Minimal JSON-RPC client. Only transport failures are retried: a JSON-RPC error
// is an answer from the node and is surfaced unchanged.

export class RpcError extends Error {
  readonly method: string;
  readonly code: number | null;

  constructor(method: string, message: string, code: number | null) {
    super(`${method}: ${message}`);
    this.name = "RpcError";
    this.method = method;
    this.code = code;
  }
}

export class TransportError extends Error {
  readonly method: string;

  constructor(method: string, cause: unknown) {
    super(`${method}: transport failed`, { cause });
    this.name = "TransportError";
    this.method = method;
  }
}

export type RpcClientOptions = {
  readonly url: string;
  readonly timeoutMs: number;
  readonly attempts: number;
};

export class RpcClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private nextId = 1;

  constructor(options: RpcClientOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs;
    this.attempts = options.attempts;
  }

  async call<T>(method: string, params: readonly unknown[]): Promise<T> {
    let lastCause: unknown;

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        return await this.send<T>(method, params);
      } catch (cause) {
        if (cause instanceof RpcError) throw cause;
        lastCause = cause;
        if (attempt < this.attempts) await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
      }
    }

    throw new TransportError(method, lastCause);
  }

  private async send<T>(method: string, params: readonly unknown[]): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;

    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`http ${response.status} from ${method}`);

    const body = (await response.json()) as {
      result?: T;
      error?: { code?: number; message?: string };
    };

    if (body.error !== undefined) {
      throw new RpcError(method, body.error.message ?? "unspecified RPC error", body.error.code ?? null);
    }
    if (body.result === undefined) throw new Error(`${method}: response carried no result`);
    return body.result;
  }
}
