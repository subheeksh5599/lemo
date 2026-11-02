export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  /** HTTP status when the call failed before reaching JSON-RPC, else null. */
  readonly status: number | null;

  constructor(code: number, message: string, data?: unknown, status: number | null = null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
    this.status = status;
  }
}

/** RPC code or message for a method the node simply does not implement. */
export function isMethodNotFound(error: unknown): boolean {
  if (!(error instanceof RpcError)) {
    return false;
  }

  return error.code === -32601 || /method not found/i.test(error.message);
}

export type JsonRpcOptions = {
  readonly url: string;
  readonly timeoutMs: number;
  /**
   * Public Portaldot endpoints answer 200 at one or two parallel requests and
   * drop the rest, so every read goes through a small queue.
   */
  readonly maxConcurrency?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  /** Ceiling for the exponential backoff, so a patient client stays bounded. */
  readonly maxRetryDelayMs?: number;
};

type JsonRpcResponse = {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
};

export type RpcStats = {
  readonly calls: number;
  readonly failures: number;
  readonly retries: number;
  readonly lastLatencyMs: number;
};

/**
 * A JSON-RPC 2.0 client with a bounded in-flight queue, a per-request timeout,
 * and retries on the failure modes the public endpoints actually show
 * (connection resets, 429/5xx, timeouts). Method-not-found is never retried:
 * it is a permanent answer, not a transient one.
 */
export class JsonRpcClient {
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #maxConcurrency: number;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #maxRetryDelayMs: number;
  #nextId = 1;
  #inFlight = 0;
  #waiters: Array<() => void> = [];
  #calls = 0;
  #failures = 0;
  #retries = 0;
  #lastLatencyMs = 0;

  constructor(options: JsonRpcOptions) {
    this.#url = options.url;
    this.#timeoutMs = options.timeoutMs;
    this.#maxConcurrency = options.maxConcurrency ?? 2;
    this.#maxAttempts = options.maxAttempts ?? 4;
    this.#retryDelayMs = options.retryDelayMs ?? 600;
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
  }

  get url(): string {
    return this.#url;
  }

  get stats(): RpcStats {
    return {
      calls: this.#calls,
      failures: this.#failures,
      retries: this.#retries,
      lastLatencyMs: this.#lastLatencyMs,
    };
  }

  async call<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.#callOnce<T>(method, params);
      } catch (error) {
        lastError = error;

        if (!isRetriable(error) || attempt === this.#maxAttempts) {
          this.#failures += 1;
          throw error;
        }

        this.#retries += 1;
        const backoff = this.#retryDelayMs * 2 ** (attempt - 1);
        await delay(Math.min(backoff, this.#maxRetryDelayMs));
      }
    }

    this.#failures += 1;
    throw lastError instanceof Error
      ? lastError
      : new RpcError(-32603, `${method}: request failed`);
  }

  async #slot(): Promise<() => void> {
    if (this.#inFlight < this.#maxConcurrency) {
      this.#inFlight += 1;
      return () => this.#release();
    }

    await new Promise<void>((resolve) => {
      this.#waiters.push(() => {
        this.#inFlight += 1;
        resolve();
      });
    });

    return () => this.#release();
  }

  #release(): void {
    this.#inFlight -= 1;
    const next = this.#waiters.shift();

    if (next !== undefined) {
      next();
    }
  }

  async #callOnce<T>(method: string, params: readonly unknown[]): Promise<T> {
    const release = await this.#slot();
    const id = this.#nextId++;
    const startedAt = performance.now();

    try {
      const response = await fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });

      if (!response.ok) {
        throw new RpcError(
          -32000,
          `${method}: HTTP ${response.status} from ${this.#url}`,
          null,
          response.status,
        );
      }

      const payload = (await response.json()) as JsonRpcResponse;

      if (payload.id !== id) {
        // A crossed response proves key A with key B's proof if it is accepted.
        throw new RpcError(-32603, `${method}: response id mismatch`);
      }

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
    } finally {
      this.#calls += 1;
      this.#lastLatencyMs = Math.round(performance.now() - startedAt);
      release();
    }
  }
}

function isRetriable(error: unknown): boolean {
  if (isMethodNotFound(error)) {
    return false;
  }

  if (error instanceof RpcError) {
    if (error.status !== null) {
      return error.status === 429 || error.status >= 500;
    }

    // JSON-RPC level server errors can be transient. -32603 is a local
    // response-shape failure (including an id mismatch), so it is not retried.
    return error.code === -32000;
  }

  // fetch throws TypeError on dropped connections, TimeoutError on abort.
  return error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
