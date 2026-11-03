/**
 * In-process fixed-window rate limiter keyed by an opaque string (the client
 * IP). One process, one map: this bounds what a single instance will spend on
 * proof verification for one caller. It is not a distributed quota.
 */

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Milliseconds until the current window resets. */
  readonly resetMs: number;
};

export type FixedWindowOptions = {
  readonly max: number;
  readonly windowMs: number;
  /** Upper bound on tracked keys before expired windows are swept. */
  readonly maxKeys?: number;
  readonly now?: () => number;
};

type Window = { start: number; count: number };

export class FixedWindowRateLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #windows = new Map<string, Window>();

  constructor(options: FixedWindowOptions) {
    if (!Number.isInteger(options.max) || options.max < 1) {
      throw new Error("rate limit max must be a positive integer");
    }
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error("rate limit window must be a positive integer of milliseconds");
    }

    this.#max = options.max;
    this.#windowMs = options.windowMs;
    this.#maxKeys = options.maxKeys ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#windows.size;
  }

  hit(key: string): RateLimitDecision {
    const now = this.#now();
    let window = this.#windows.get(key);

    if (window === undefined || now - window.start >= this.#windowMs) {
      if (window === undefined && this.#windows.size >= this.#maxKeys) {
        this.#sweep(now);
      }

      window = { start: now, count: 0 };
      this.#windows.set(key, window);
    }

    window.count += 1;

    const resetMs = Math.max(0, window.start + this.#windowMs - now);

    return {
      allowed: window.count <= this.#max,
      limit: this.#max,
      remaining: Math.max(0, this.#max - window.count),
      resetMs,
    };
  }

  #sweep(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.start >= this.#windowMs) {
        this.#windows.delete(key);
      }
    }

    // Still full of live windows: drop the oldest insertions rather than grow
    // without bound. Map iteration order is insertion order.
    while (this.#windows.size >= this.#maxKeys) {
      const oldest = this.#windows.keys().next();
      if (oldest.done === true) break;
      this.#windows.delete(oldest.value);
    }
  }
}
