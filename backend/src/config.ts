// Configuration comes from the environment only. Nothing defaults to a machine-local
// path or to an endpoint the operator did not choose.

import type { LogLevel } from "./observability/telemetry.ts";

export type Config = {
  readonly rpcUrl: string;
  readonly evmRpcUrl: string | null;
  readonly statementsUrl: string;
  readonly databasePath: string;
  readonly listenHost: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly minConfirmations: number;
  readonly maxFields: number;
  readonly logLevel: LogLevel;
  readonly rateLimitPerSecond: number;
  readonly rateLimitBurst: number;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ConfigError(`${name} must be a positive integer, got ${raw}`);
  return parsed;
}

function requiredUrl(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw === "") throw new ConfigError(`${name} is required`);
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    throw new ConfigError(`${name} must be an http(s) URL, got ${raw}`);
  }
  return raw;
}

function optionalUrl(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined || raw === "") return null;
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    throw new ConfigError(`${name} must be an http(s) URL, got ${raw}`);
  }
  return raw;
}

function logLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env["LEMO_LOG_LEVEL"] ?? "info";
  if (raw !== "debug" && raw !== "info" && raw !== "warn" && raw !== "error") {
    throw new ConfigError(`LEMO_LOG_LEVEL must be debug, info, warn or error, got ${raw}`);
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const rpcUrl = requiredUrl(env, "LEMO_RPC_URL");

  return {
    rpcUrl,
    evmRpcUrl: optionalUrl(env, "LEMO_EVM_RPC_URL"),
    statementsUrl: optionalUrl(env, "LEMO_STATEMENTS_RPC_URL") ?? rpcUrl,
    databasePath: env["LEMO_DB_PATH"] ?? "lemo.db",
    listenHost: env["LEMO_HOST"] ?? "127.0.0.1",
    port: positiveInteger(env, "LEMO_PORT", 8080),
    timeoutMs: positiveInteger(env, "LEMO_RPC_TIMEOUT_MS", 10_000),
    minConfirmations: positiveInteger(env, "LEMO_MIN_CONFIRMATIONS", 0),
    maxFields: positiveInteger(env, "LEMO_MAX_FIELDS", 32),
    logLevel: logLevel(env),
    rateLimitPerSecond: positiveInteger(env, "LEMO_RATE_LIMIT_PER_SECOND", 50),
    rateLimitBurst: positiveInteger(env, "LEMO_RATE_LIMIT_BURST", 100),
  };
}
