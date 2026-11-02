import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from "fastify";
import type { ZodType } from "zod";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";
import type { ProofService } from "./service.ts";
import {
  evmWitnessDataSchema,
  healthDataSchema,
  nativeWitnessDataSchema,
  networkDataSchema,
  readsDataSchema,
  verifyNativeBodySchema,
  verifyNativeDataSchema,
  witnessEvmQuerySchema,
  witnessNativeQuerySchema,
} from "./schemas.ts";
import { asHex } from "./util/bytes.ts";

export type BuildAppOptions = {
  readonly config: Config;
  readonly service: ProofService;
  readonly logger?: FastifyServerOptions["logger"];
};

/**
 * The HTTP surface.
 *
 * Every request carries an id (`x-request-id`, echoed in the body), every
 * response body is validated against its zod schema before it is sent, and
 * every refusal is a structured `{ error: { code, message, details } }` with a
 * status code that means the same thing.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: options.config.logLevel },
    genReqId: () => randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  });

  const service = options.service;

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", String(request.id));
    // Read-only public data. The console and the proof service are different
    // origins, so the API states its CORS contract explicitly.
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-max-age", "600");
    return payload;
  });

  app.options("/*", async (_request, reply) => {
    return reply.status(204).send();
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const requestId = String(request.id);

    if (error instanceof AppError) {
      request.log.warn(
        { requestId, code: error.code, status: error.status },
        "request refused",
      );

      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === null ? {} : { details: error.details }),
        },
        requestId,
      });
    }

    const status = typeof error.statusCode === "number" ? error.statusCode : 500;

    if (status >= 400 && status < 500) {
      request.log.warn({ requestId, status }, "malformed request");

      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message:
            status === 400 ? "request body could not be read as JSON" : "malformed request",
        },
        requestId,
      });
    }

    request.log.error({ requestId, err: error }, "unhandled request failure");

    return reply.status(500).send({
      error: { code: "INTERNAL", message: "an unexpected error occurred" },
      requestId,
    });
  });

  const routeMethods: Record<string, readonly string[]> = {
    "/healthz": ["GET"],
    "/v1/network": ["GET"],
    "/v1/reads": ["GET"],
    "/v1/witness/native": ["GET"],
    "/v1/verify/native": ["POST"],
    "/v1/witness/evm": ["GET"],
  };

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    const allowed = routeMethods[path];

    if (allowed !== undefined && !allowed.includes(request.method)) {
      reply.header("allow", allowed.join(", "));
      return reply.status(405).send({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `${request.method} is not allowed on ${path}`,
        },
        requestId: String(request.id),
      });
    }

    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `no route for ${request.method} ${path}`,
      },
      requestId: String(request.id),
    });
  });

  app.get("/healthz", async (request, reply) => {
    return send(reply, request.id, healthDataSchema, service.health());
  });

  app.get("/v1/network", async (request, reply) => {
    return send(reply, request.id, networkDataSchema, await service.network());
  });

  app.get("/v1/reads", async (request, reply) => {
    return send(reply, request.id, readsDataSchema, service.reads());
  });

  app.get("/v1/witness/native", async (request, reply) => {
    const query = parse(witnessNativeQuerySchema, request.query);
    const witness = await service.nativeWitness({
      key: asHex(query.key),
      at: query.at,
    });

    return send(reply, request.id, nativeWitnessDataSchema, witness);
  });

  app.post("/v1/verify/native", async (request, reply) => {
    const body = parse(verifyNativeBodySchema, request.body);
    const result = await service.verifyNative({
      key: asHex(body.key),
      at: body.at,
      ...(body.proof === undefined ? {} : { proof: body.proof.map(asHex) }),
      ...(body.value === undefined
        ? {}
        : { value: body.value === null ? null : asHex(body.value) }),
    });

    return send(reply, request.id, verifyNativeDataSchema, result);
  });

  app.get("/v1/witness/evm", async (request, reply) => {
    const query = parse(witnessEvmQuerySchema, request.query);
    const witness = await service.evmWitness({
      address: asHex(query.address),
      at: query.at,
    });

    return send(reply, request.id, evmWitnessDataSchema, witness);
  });

  return app;
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});

  if (!result.success) {
    throw AppError.invalid(
      "request validation failed",
      result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(request)",
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  return result.data;
}

function send<T>(
  reply: FastifyReply,
  requestId: string,
  schema: ZodType<T>,
  data: T,
): FastifyReply {
  // Validating on the way out means a handler that drifts from its contract
  // fails here, with a 500, rather than silently shipping a wrong shape.
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    throw AppError.internal("response did not match its schema", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  return reply.status(200).send({ requestId, data: parsed.data });
}
