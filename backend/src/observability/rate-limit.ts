// Token-bucket rate limiting per client. Kept in process on purpose: the service holds
// no authority, so a limiter reset costs a retry, never a wrong answer.

export type Decision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number };

type Bucket = { tokens: number; updatedAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(input: { readonly perSecond: number; readonly burst: number }) {
    this.capacity = input.burst;
    this.refillPerMs = input.perSecond / 1000;
  }

  take(client: string, now = Date.now()): Decision {
    const bucket = this.buckets.get(client) ?? { tokens: this.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      this.buckets.set(client, bucket);
      return { allowed: false, retryAfterMs: Math.ceil((1 - bucket.tokens) / this.refillPerMs) };
    }

    bucket.tokens -= 1;
    this.buckets.set(client, bucket);
    return { allowed: true };
  }

  /** Drops idle buckets so a long-running process cannot accumulate one entry per client forever. */
  prune(now = Date.now()): void {
    for (const [client, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 60_000) this.buckets.delete(client);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
