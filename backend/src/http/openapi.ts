// OpenAPI 3.1 description of the service's own routes, served at /openapi.json so a
// client can be generated without reading the source.

import type { Config } from "../config.ts";

const fieldSpec = {
  type: "object",
  required: ["label", "pallet", "item", "hasher", "args", "decode"],
  properties: {
    label: { type: "string" },
    pallet: { type: "string" },
    item: { type: "string" },
    hasher: { type: "string", enum: ["blake2_128", "blake2_128_concat", "blake2_64", "blake2_64_concat", "blake2_256", "twox64", "twox64_concat", "twox128", "twox256", "identity"] },
    args: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "value"],
        properties: {
          type: { type: "string", enum: ["bytes", "vec", "account32", "hash32", "u32", "u64", "u128"] },
          value: { type: "string" },
        },
      },
    },
    decode: { type: "string", enum: ["bytes", "u32", "u64", "u128"] },
  },
} as const;

export function openApiDocument(config: Config): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "LEMO proof service",
      version: "0.2.0",
      description:
        "Serves finalized-state proof packages for LEMO titles and evaluates the two protocol rules against them. " +
        "The service holds no authority: every answer carries the proof needed to check it independently.",
    },
    servers: [{ url: `http://${config.listenHost}:${config.port}` }],
    paths: {
      "/health": {
        get: {
          summary: "Chain identity, finalized head and capability report",
          responses: { "200": { description: "service state including whether the EVM RPC and statement store are usable" } },
        },
      },
      "/metrics": {
        get: {
          summary: "Prometheus metrics",
          responses: { "200": { description: "text exposition format", content: { "text/plain": {} } } },
        },
      },
      "/titles": {
        get: { summary: "List registered title bindings", responses: { "200": { description: "bindings" } } },
        post: {
          summary: "Declare which chain records make up a title",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["titleId", "fields"],
                  properties: {
                    titleId: { type: "string", pattern: "^0x[0-9a-f]{64}$" },
                    label: { type: "string" },
                    evm: {
                      type: "object",
                      required: ["contract", "standard"],
                      properties: {
                        contract: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
                        standard: { type: "string", enum: ["erc20", "erc721"] },
                      },
                    },
                    fields: { type: "array", minItems: 1, items: fieldSpec },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "binding stored" }, "400": { description: "invalid binding" } },
        },
      },
      "/titles/{titleId}": {
        get: {
          summary: "One binding",
          parameters: [{ name: "titleId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "binding" }, "404": { description: "unknown title" } },
        },
      },
      "/titles/{titleId}/proof": {
        get: {
          summary: "Build, self-verify and return a proof package",
          parameters: [
            { name: "titleId", in: "path", required: true, schema: { type: "string" } },
            { name: "minConfirmations", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: { "200": { description: "package with its verification report" }, "404": { description: "unknown title" } },
        },
      },
      "/titles/{titleId}/transfer-check": {
        get: {
          summary: "Rule 1: may the EVM representation move on this title state?",
          parameters: [
            { name: "titleId", required: true, in: "path", schema: { type: "string" } },
            { name: "minConfirmations", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: { "200": { description: "verdict with every individual check and its reason" } },
        },
      },
      "/titles/{titleId}/unbond-check": {
        get: {
          summary: "Rule 2: may the native backing be unlocked?",
          responses: { "200": { description: "verdict; unavailable EVM supply is a refusal, not a zero" } },
        },
      },
      "/titles/{titleId}/revisions": {
        get: {
          summary: "Accepted revision history, newest first",
          responses: { "200": { description: "revision, digest, block and acceptance time" } },
        },
        post: {
          summary: "Accept the current revision and announce it on its statement topic",
          responses: { "201": { description: "accepted and announced" }, "409": { description: "stale revision" } },
        },
      },
      "/proofs/verify": {
        post: {
          summary: "Re-verify a package and evaluate Rule 1 against it",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["package"],
                  properties: {
                    package: { type: "object" },
                    minConfirmations: { type: "integer", minimum: 0 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "verification report and rule verdict" } },
        },
      },
      "/proofs/consume": {
        post: {
          summary: "Mark a package digest as used; the second attempt is refused",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["digest", "titleId", "operation"],
                  properties: {
                    digest: { type: "string" },
                    titleId: { type: "string" },
                    operation: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "consumed" }, "409": { description: "replayed" } },
        },
      },
    },
  };
}
