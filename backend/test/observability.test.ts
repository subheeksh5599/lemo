import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/observability/rate-limit.ts";
import { Logger, Metrics } from "../src/observability/telemetry.ts";

test("a bucket allows its burst, then refuses until it refills", () => {
  const limiter = new RateLimiter({ perSecond: 10, burst: 3 });
  const now = 1_000_000;

  assert.equal(limiter.take("client", now).allowed, true);
  assert.equal(limiter.take("client", now).allowed, true);
  assert.equal(limiter.take("client", now).allowed, true);

  const denied = limiter.take("client", now);
  assert.equal(denied.allowed, false);
  if (!denied.allowed) assert.ok(denied.retryAfterMs > 0);

  assert.equal(limiter.take("client", now + 100).allowed, true, "one token refills after 100 ms at 50/s");
});

test("limits are per client", () => {
  const limiter = new RateLimiter({ perSecond: 1, burst: 1 });
  assert.equal(limiter.take("a").allowed, true);
  assert.equal(limiter.take("a").allowed, false);
  assert.equal(limiter.take("b").allowed, true);
});

test("pruning drops idle buckets so the client list cannot grow without bound", () => {
  const limiter = new RateLimiter({ perSecond: 10, burst: 2 });
  const now = Date.now();
  limiter.take("a", now);
  assert.equal(limiter.size, 1);
  limiter.prune(now + 120_000);
  assert.equal(limiter.size, 0);
});

test("metrics render in the Prometheus text format", () => {
  const metrics = new Metrics();
  metrics.increment("requests_total");
  metrics.increment("requests_total");
  metrics.gauge("titles_known", 3);
  metrics.observe("request_duration_ms", 10);
  metrics.observe("request_duration_ms", 30);

  const text = metrics.render();
  assert.match(text, /# TYPE lemo_requests_total counter/);
  assert.match(text, /lemo_requests_total 2/);
  assert.match(text, /lemo_titles_known 3/);
  assert.match(text, /lemo_request_duration_ms_count 2/);
});

test("logs are one JSON object per line and honour the level", () => {
  const lines: string[] = [];
  const logger = new Logger({ level: "warn", sink: (line) => lines.push(line) });

  logger.info("ignored", { a: 1 });
  logger.error("kept", { code: "X" });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(parsed["message"], "kept");
  assert.equal(parsed["level"], "error");
  assert.equal(parsed["code"], "X");
  assert.match(String(parsed["time"]), /^\d{4}-\d{2}-\d{2}T/);
});
