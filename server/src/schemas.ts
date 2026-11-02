import { z } from "zod";

/**
 * Wire schemas. Requests are parsed with these; responses are parsed with them
 * again on the way out, so a handler that drifts from its contract fails loudly
 * at the edge instead of shipping a shape the client cannot read.
 */

export const hexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/u, "expected 0x-prefixed hex")
  .refine((value) => value.length % 2 === 0, "hex must have an even number of characters");

export const storageKeySchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/u, "storage key must be 0x-prefixed, even-length, non-empty hex")
  .max(2 + 1024 * 2, "storage key is longer than 1024 bytes");

export const hash32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/u, "expected a 32-byte hash");

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u, "expected a 20-byte EVM address");

export const atSchema = z.union([
  z.literal("finalized"),
  z.literal("best"),
  hash32Schema,
  z.number().int().min(0),
  z
    .string()
    .regex(/^\d+$/u, "expected 'finalized', 'best', a block hash or a block number")
    .transform((value) => Number(value)),
]);

export type AtInput = z.infer<typeof atSchema>;

export const nodeKindSchema = z.enum([
  "empty",
  "leaf",
  "branch",
  "branchWithValue",
  "hashedLeaf",
  "hashedBranchWithValue",
]);

export const trieErrorKindSchema = z.enum([
  "INVALID_INPUT",
  "EMPTY_PROOF",
  "ROOT_MISSING",
  "NODE_MISSING",
  "VALUE_NODE_MISSING",
  "NODE_HASH_MISMATCH",
  "MALFORMED_NODE",
  "DUPLICATE_NODE",
  "PATH_DIVERGED",
  "NO_CHILD",
  "BRANCH_WITHOUT_VALUE",
  "EMPTY_NODE",
  "VALUE_MISMATCH",
]);

export const proofStepSchema = z.object({
  depth: z.number().int().min(0),
  node: hash32Schema,
  kind: nodeKindSchema,
  partial: z.number().int().min(0),
  position: z.number().int().min(0),
  bitmap: z.number().int().nullable(),
  childNibble: z.number().int().min(0).max(15).nullable(),
  valueLength: z.number().int().min(0).nullable(),
  valueHashed: z.boolean(),
});

export const proofResultSchema = z.object({
  status: z.enum(["present", "absent", "mismatch", "invalid", "incomplete"]),
  rootMatches: z.boolean(),
  root: z.string(),
  key: z.string(),
  value: z.string().nullable(),
  expectedValue: z.string().nullable(),
  steps: z.array(proofStepSchema),
  nodesSupplied: z.number().int().min(0),
  nodesUsed: z.number().int().min(0),
  error: z
    .object({
      kind: trieErrorKindSchema,
      message: z.string(),
    })
    .nullable(),
});

export const blockRefSchema = z.object({
  hash: hash32Schema,
  number: z.number().int().min(0),
  parentHash: hash32Schema,
  stateRoot: hash32Schema,
  finalized: z.boolean(),
  ageBlocks: z.number().int().min(0),
});

export const decodedValueSchema = z.object({
  label: z.string().nullable(),
  encoding: z.string(),
  value: z.union([z.number(), z.string()]).nullable(),
  note: z.string().nullable(),
});

/* ------------------------------------------------------------------ requests */

export const healthQuerySchema = z.object({}).strict();

export const witnessNativeQuerySchema = z
  .object({
    key: storageKeySchema,
    at: atSchema.optional(),
  })
  .strict();

export const verifyNativeBodySchema = z
  .object({
    key: storageKeySchema,
    at: atSchema.optional(),
    /** Supplied proof nodes. Optional: when omitted the service fetches one. */
    proof: z.array(hexSchema).min(1).max(512).optional(),
    /** A claim about the value. `null` claims the key is absent. */
    value: hexSchema.nullable().optional(),
  })
  .strict();

export const witnessEvmQuerySchema = z
  .object({
    address: addressSchema,
    at: z.union([z.literal("finalized"), z.literal("latest")]).optional(),
  })
  .strict();

/* ----------------------------------------------------------------- responses */

export const healthDataSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  uptimeSeconds: z.number().min(0),
  now: z.string(),
  pid: z.number().int(),
});

export const networkDataSchema = z.object({
  substrate: z.object({
    url: z.string(),
    chain: z.string(),
    chainType: z.string(),
    version: z.string(),
    genesisHash: hash32Schema,
    configuredGenesisHash: hash32Schema,
    genesisMatches: z.boolean(),
  }),
  heads: z.object({
    best: z.object({ hash: hash32Schema, number: z.number().int().min(0) }),
    finalized: z.object({
      hash: hash32Schema,
      number: z.number().int().min(0),
      stateRoot: hash32Schema,
    }),
    finalityLagBlocks: z.number().int().min(0),
  }),
  evm: z.object({
    url: z.string(),
    chainId: z.number().int(),
    configuredChainId: z.number().int(),
    chainIdMatches: z.boolean(),
    head: z
      .object({ number: z.number().int().min(0), hash: hash32Schema })
      .nullable(),
    readProofSupported: z.boolean(),
    note: z.string().nullable(),
  }),
  latencyMs: z.record(z.string(), z.number().min(0)),
});

export const nativeWitnessDataSchema = z.object({
  key: storageKeySchema,
  block: blockRefSchema,
  nodes: z.array(hexSchema).min(1),
  nodeCount: z.number().int().min(1),
  verification: proofResultSchema,
  storageValue: z.string().nullable(),
  agreesWithStorage: z.boolean(),
  decoded: decodedValueSchema.nullable(),
  blockNumberAgrees: z.boolean().nullable(),
});

export const verifyNativeDataSchema = z.object({
  key: storageKeySchema,
  block: blockRefSchema,
  verified: z.boolean(),
  present: z.boolean(),
  /** Always "chain": a caller-supplied root is never accepted. */
  rootSource: z.literal("chain"),
  proofSource: z.enum(["supplied", "fetched"]),
  value: z.string().nullable(),
  decoded: decodedValueSchema.nullable(),
  verification: proofResultSchema,
});

export const evmWitnessDataSchema = z.object({
  address: addressSchema,
  supported: z.boolean(),
  /** The node's own refusal, when it has one. */
  reason: z
    .object({
      code: z.number().int(),
      message: z.string(),
      method: z.string(),
    })
    .nullable(),
  evm: z.object({
    url: z.string(),
    chainId: z.number().int(),
    blockNumber: z.number().int().min(0),
  }),
  witness: z
    .object({
      blockNumber: z.number().int().min(0),
      accountProofNodes: z.number().int().min(0),
      storageHash: hash32Schema,
      /** This service has no EVM MPT verifier, so nothing is claimed. */
      verified: z.literal(false),
      note: z.string(),
    })
    .nullable(),
  note: z.string(),
});

export const readSchema = z.object({
  method: z.string(),
  transport: z.enum(["substrate", "evm"]),
  purpose: z.string(),
  usedBy: z.array(z.string()).min(1),
});

export const readsDataSchema = z.object({
  reads: z.array(readSchema).min(1),
  notes: z.array(z.string()),
});

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string(),
});

/* --------------------------------------------------------------------- types */

export type HealthData = z.infer<typeof healthDataSchema>;
export type NetworkData = z.infer<typeof networkDataSchema>;
export type BlockRef = z.infer<typeof blockRefSchema>;
export type ProofResultData = z.infer<typeof proofResultSchema>;
export type DecodedValueData = z.infer<typeof decodedValueSchema>;
export type NativeWitnessData = z.infer<typeof nativeWitnessDataSchema>;
export type VerifyNativeData = z.infer<typeof verifyNativeDataSchema>;
export type EvmWitnessData = z.infer<typeof evmWitnessDataSchema>;
export type ReadsData = z.infer<typeof readsDataSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
