import { z } from "zod";

/**
 * Runtime configuration. Every value is sourced from the environment so the
 * same build runs against testnet, a local fork or mainnet without edits.
 * The defaults point at the live Portaldot V3 testnet, which is the network
 * the protocol is being built against.
 */

export const PORTALDOT_V3_TESTNET = {
  substrateRpc: "https://test-node-v3.portaldot.dev",
  evmRpc: "https://test-evm-rpc-v3.portaldot.dev",
  genesisHash: "0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd",
  chainId: 420420777,
  ss58Prefix: 42,
} as const;

const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hash");

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");

const envSchema = z.object({
  LEMO_HOST: z.string().min(1).default("127.0.0.1"),
  LEMO_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LEMO_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  LEMO_SUBSTRATE_RPC: z.url().default(PORTALDOT_V3_TESTNET.substrateRpc),
  LEMO_EVM_RPC: z.url().default(PORTALDOT_V3_TESTNET.evmRpc),
  LEMO_GENESIS_HASH: hex32.default(PORTALDOT_V3_TESTNET.genesisHash),
  LEMO_CHAIN_ID: z.coerce.number().int().positive().default(PORTALDOT_V3_TESTNET.chainId),

  LEMO_TITLE_CONTRACT: address.optional(),
  LEMO_TOKEN_CONTRACT: address.optional(),

  /** A proof older than this many finalized blocks is refused. */
  LEMO_PROOF_MAX_AGE_BLOCKS: z.coerce.number().int().positive().default(300),
  /** Hard wall-clock ceiling on an accepted proof, independent of block age. */
  LEMO_PROOF_MAX_AGE_MS: z.coerce.number().int().positive().default(30 * 60_000),
  /** Storage proofs are assembled from this many lookups at most. */
  LEMO_PROOF_MAX_KEYS: z.coerce.number().int().positive().max(256).default(64),

  LEMO_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  /** Comma-separated browser origins allowed to call the API cross-origin. */
  CORS_ORIGINS: z.string().optional(),
  /** Requests per window, per client IP, on `/v1/verify/*`. */
  LEMO_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  LEMO_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Trust `x-forwarded-for` (only behind a proxy you control). */
  LEMO_TRUST_PROXY: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

export const DEFAULT_CORS_ORIGINS = [
  "https://lemo-ebon.vercel.app",
  "http://localhost:3000",
] as const;

/**
 * Parse `CORS_ORIGINS`. Each entry must be a bare origin (scheme, host,
 * optional port); `*` is refused so the allowlist cannot silently become open.
 */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return [...DEFAULT_CORS_ORIGINS];
  }

  const origins = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  for (const origin of origins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`invalid configuration: CORS_ORIGINS entry "${origin}" is not an origin`);
    }

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      `${parsed.protocol}//${parsed.host}` !== origin.replace(/\/$/u, "")
    ) {
      throw new Error(
        `invalid configuration: CORS_ORIGINS entry "${origin}" must be scheme://host[:port]`,
      );
    }
  }

  return [...new Set(origins.map((origin) => origin.replace(/\/$/u, "")))];
}

export type Config = {
  readonly host: string;
  readonly port: number;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly substrate: {
    readonly url: string;
    readonly genesisHash: string;
  };
  readonly evm: {
    readonly url: string;
    readonly chainId: number;
  };
  readonly contracts: {
    readonly title: `0x${string}` | null;
    readonly token: `0x${string}` | null;
  };
  readonly proofs: {
    readonly maxAgeBlocks: number;
    readonly maxAgeMs: number;
    readonly maxKeys: number;
  };
  readonly rpcTimeoutMs: number;
  readonly cors: {
    readonly origins: readonly string[];
  };
  readonly rateLimit: {
    readonly max: number;
    readonly windowMs: number;
  };
  readonly trustProxy: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid configuration: ${detail}`);
  }

  const value = parsed.data;

  return {
    host: value.LEMO_HOST,
    port: value.LEMO_PORT,
    logLevel: value.LEMO_LOG_LEVEL,
    substrate: {
      url: value.LEMO_SUBSTRATE_RPC,
      genesisHash: value.LEMO_GENESIS_HASH,
    },
    evm: {
      url: value.LEMO_EVM_RPC,
      chainId: value.LEMO_CHAIN_ID,
    },
    contracts: {
      title: (value.LEMO_TITLE_CONTRACT as `0x${string}` | undefined) ?? null,
      token: (value.LEMO_TOKEN_CONTRACT as `0x${string}` | undefined) ?? null,
    },
    proofs: {
      maxAgeBlocks: value.LEMO_PROOF_MAX_AGE_BLOCKS,
      maxAgeMs: value.LEMO_PROOF_MAX_AGE_MS,
      maxKeys: value.LEMO_PROOF_MAX_KEYS,
    },
    rpcTimeoutMs: value.LEMO_RPC_TIMEOUT_MS,
    cors: {
      origins: parseCorsOrigins(value.CORS_ORIGINS),
    },
    rateLimit: {
      max: value.LEMO_RATE_LIMIT_MAX,
      windowMs: value.LEMO_RATE_LIMIT_WINDOW_MS,
    },
    trustProxy: value.LEMO_TRUST_PROXY,
  };
}
