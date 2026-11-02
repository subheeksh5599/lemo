// Configuration comes from the environment only; nothing here has a network
// default that silently points at a personal endpoint.

export type Config = {
  readonly port: number;
  readonly databasePath: string;
  readonly rpcUrl: string;
  readonly rpcTimeoutMs: number;
  readonly rpcAttempts: number;
  readonly minConfirmations: number;
  readonly maxKeysPerPackage: number;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ConfigError(`${name} must be a positive integer, got ${value}`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const rpcUrl = env["LEMO_RPC_URL"];
  if (rpcUrl === undefined || rpcUrl === "") {
    throw new ConfigError("LEMO_RPC_URL is required: the Portaldot V3 node this service reads");
  }

  return {
    port: positiveInteger(env["LEMO_PORT"], "LEMO_PORT", 8080),
    databasePath: env["LEMO_DB_PATH"] ?? "lemo.db",
    rpcUrl,
    rpcTimeoutMs: positiveInteger(env["LEMO_RPC_TIMEOUT_MS"], "LEMO_RPC_TIMEOUT_MS", 10_000),
    rpcAttempts: positiveInteger(env["LEMO_RPC_ATTEMPTS"], "LEMO_RPC_ATTEMPTS", 3),
    minConfirmations: positiveInteger(env["LEMO_MIN_CONFIRMATIONS"], "LEMO_MIN_CONFIRMATIONS", 0),
    maxKeysPerPackage: positiveInteger(env["LEMO_MAX_KEYS"], "LEMO_MAX_KEYS", 32),
  };
}
