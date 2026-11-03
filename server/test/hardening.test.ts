import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CORS_ORIGINS, loadConfig, parseCorsOrigins } from "../src/config.ts";
import {
  MAX_PROOF_NODE_BYTES,
  MAX_VERIFY_DECODED_BYTES,
  verifyNativeBodySchema,
} from "../src/schemas.ts";
import { redactUrl, redactedOrigin } from "../src/util/redact.ts";
import { FixedWindowRateLimiter } from "../src/util/rateLimit.ts";

const KEY = `0x${"26".repeat(32)}`;

test("redactUrl keeps the origin and flags anything that could hold a key", () => {
  assert.deepEqual(redactUrl("https://test-node-v3.portaldot.dev"), {
    url: "https://test-node-v3.portaldot.dev",
    hasCredentials: false,
  });
  assert.deepEqual(redactUrl("https://test-node-v3.portaldot.dev/"), {
    url: "https://test-node-v3.portaldot.dev",
    hasCredentials: false,
  });
  assert.deepEqual(redactUrl("https://rpc.example/v2/abc123"), {
    url: "https://rpc.example",
    hasCredentials: true,
  });
  assert.deepEqual(redactUrl("https://rpc.example:8443/?apikey=abc"), {
    url: "https://rpc.example:8443",
    hasCredentials: true,
  });
  assert.deepEqual(redactUrl("https://user:pass@rpc.example"), {
    url: "https://rpc.example",
    hasCredentials: true,
  });
  assert.deepEqual(redactUrl("wss://rpc.example/ws/KEY"), {
    url: "wss://rpc.example",
    hasCredentials: true,
  });
  assert.deepEqual(redactUrl("not a url"), { url: "(unparseable url)", hasCredentials: true });
  assert.equal(redactedOrigin("http://127.0.0.1:9944/secret"), "http://127.0.0.1:9944");
});

test("CORS origins default to the console and localhost, and reject wildcards", () => {
  assert.deepEqual(parseCorsOrigins(undefined), [...DEFAULT_CORS_ORIGINS]);
  assert.deepEqual(parseCorsOrigins("  "), [...DEFAULT_CORS_ORIGINS]);
  assert.deepEqual(parseCorsOrigins("https://a.example,https://a.example/, http://b:3000"), [
    "https://a.example",
    "http://b:3000",
  ]);
  assert.throws(() => parseCorsOrigins("*"), /CORS_ORIGINS/);
  assert.throws(() => parseCorsOrigins("https://a.example/path"), /scheme:\/\/host/);
  assert.throws(() => parseCorsOrigins("ftp://a.example"), /scheme:\/\/host/);

  const config = loadConfig({ CORS_ORIGINS: "https://x.example" } as NodeJS.ProcessEnv);
  assert.deepEqual(config.cors.origins, ["https://x.example"]);
  assert.equal(config.rateLimit.max, 30);
  assert.equal(config.rateLimit.windowMs, 60_000);
  assert.equal(config.trustProxy, false);
});

test("fixed-window limiter counts per key and resets on the window boundary", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ max: 3, windowMs: 1000, now: () => now });

  assert.equal(limiter.hit("a").remaining, 2);
  assert.equal(limiter.hit("a").remaining, 1);
  assert.equal(limiter.hit("a").allowed, true);
  const blocked = limiter.hit("a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.resetMs, 1000);
  assert.equal(limiter.hit("b").allowed, true);

  now = 999;
  assert.equal(limiter.hit("a").allowed, false);
  now = 1000;
  assert.equal(limiter.hit("a").allowed, true);

  assert.throws(() => new FixedWindowRateLimiter({ max: 0, windowMs: 1 }));
  assert.throws(() => new FixedWindowRateLimiter({ max: 1, windowMs: 0 }));
});

test("fixed-window limiter never tracks more than maxKeys clients", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 1000, maxKeys: 4, now: () => now });

  for (let i = 0; i < 100; i += 1) {
    limiter.hit(`ip-${i}`);
    assert.ok(limiter.size <= 4);
  }

  now = 5000;
  limiter.hit("fresh");
  assert.ok(limiter.size <= 4);
});

test("verify body caps per-node length, value length and total decoded bytes", () => {
  const atCap = `0x${"aa".repeat(MAX_PROOF_NODE_BYTES)}`;
  const overCap = `0x${"aa".repeat(MAX_PROOF_NODE_BYTES + 1)}`;

  assert.equal(verifyNativeBodySchema.safeParse({ key: KEY, proof: [atCap] }).success, true);
  assert.equal(verifyNativeBodySchema.safeParse({ key: KEY, proof: [overCap] }).success, false);
  assert.equal(verifyNativeBodySchema.safeParse({ key: KEY, proof: ["0xabc"] }).success, false);

  const nodesForTotal = Math.ceil(MAX_VERIFY_DECODED_BYTES / MAX_PROOF_NODE_BYTES) + 1;
  const total = verifyNativeBodySchema.safeParse({
    key: KEY,
    proof: Array(nodesForTotal).fill(atCap),
  });
  assert.equal(total.success, false);
  assert.match(JSON.stringify(total.error?.issues), /decoded bytes in total/);

  const exactlyTotal = verifyNativeBodySchema.safeParse({
    key: KEY,
    proof: Array(MAX_VERIFY_DECODED_BYTES / MAX_PROOF_NODE_BYTES).fill(atCap),
  });
  assert.equal(exactlyTotal.success, true);

  assert.equal(
    verifyNativeBodySchema.safeParse({ key: KEY, value: `0x${"00".repeat(64 * 1024 + 1)}` }).success,
    false,
  );
  assert.equal(verifyNativeBodySchema.safeParse({ key: KEY, value: null }).success, true);
  assert.equal(
    verifyNativeBodySchema.safeParse({ key: KEY, proof: Array(513).fill("0x00") }).success,
    false,
  );
});
