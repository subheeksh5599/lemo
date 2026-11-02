// HTTP surface. Reads are public; the only writes are this service's own records
// (a registered binding, an accepted revision, a consumed digest).

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Config } from "../config.ts";
import { NotFoundError, type ChainService } from "../service.ts";
import { BindingError } from "../titles/model.ts";
import { Logger, Metrics } from "../observability/telemetry.ts";
import { RateLimiter } from "../observability/rate-limit.ts";
import { openApiDocument } from "./openapi.ts";

const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) throw new HttpError(413, "BODY_TOO_LARGE", "request body exceeds 2 MiB");
    chunks.push(buffer);
  }

  if (total === 0) throw new HttpError(400, "EMPTY_BODY", "a JSON body is required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "BAD_JSON", "body is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "BAD_JSON", "body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, body: unknown, requestId: string): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  response.end(payload);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function describeFailure(cause: unknown): { status: number; code: string; message: string } {
  if (cause instanceof HttpError) return { status: cause.status, code: cause.code, message: cause.message };
  if (cause instanceof BindingError) return { status: 400, code: "INVALID_BINDING", message: cause.message };
  if (cause instanceof NotFoundError) return { status: 404, code: "NOT_FOUND", message: cause.message };
  if (cause instanceof RangeError) return { status: 400, code: "INVALID_INPUT", message: cause.message };

  const candidate = cause as { code?: unknown } | null;
  const code = candidate?.code;
  if (typeof code === "string") return { status: 422, code, message: messageOf(cause) };

  return { status: 500, code: "INTERNAL", message: messageOf(cause) };
}

function integerParam(raw: string | null, name: string): number | undefined {
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, "INVALID_INPUT", `${name} must be a non-negative integer`);
  return parsed;
}

export class HttpServer {
  private readonly server: Server;
  private readonly service: ChainService;
  private readonly config: Config;
  private readonly metrics: Metrics;
  private readonly limiter: RateLimiter;
  private readonly logger: Logger;

  constructor(input: {
    readonly service: ChainService;
    readonly config: Config;
    readonly metrics?: Metrics;
    readonly logger?: Logger;
  }) {
    this.service = input.service;
    this.config = input.config;
    this.metrics = input.metrics ?? new Metrics();
    this.logger = input.logger ?? new Logger({ level: input.config.logLevel });
    this.limiter = new RateLimiter({ perSecond: input.config.rateLimitPerSecond, burst: input.config.rateLimitBurst });

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  listen(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.config.port, this.config.listenHost, () => {
        const address = this.server.address();
        resolve({ port: typeof address === "object" && address !== null ? address.port : this.config.port });
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
    });
    this.service.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
    const startedAt = performance.now();
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    this.metrics.increment("requests_total");

    const client = request.socket.remoteAddress ?? "unknown";
    const decision = this.limiter.take(client);
    if (!decision.allowed) {
      this.metrics.increment("requests_rate_limited");
      response.setHeader("retry-after", Math.ceil(decision.retryAfterMs / 1000).toString());
      send(response, 429, { error: { code: "RATE_LIMITED", message: "too many requests" } }, requestId);
      this.logger.warn("rate limited", { requestId, client, path });
      return;
    }

    try {
      await this.route(request, response, requestId);
      this.metrics.increment("requests_ok");
    } catch (cause) {
      const failure = describeFailure(cause);
      this.metrics.increment(`requests_${failure.status}`);
      if (failure.status >= 500) this.logger.error("request failed", { requestId, path, code: failure.code, message: failure.message });
      send(response, failure.status, { error: { code: failure.code, message: failure.message, requestId } }, requestId);
    } finally {
      const duration = performance.now() - startedAt;
      this.metrics.observe("request_duration_ms", duration);
      this.metrics.gauge("titles_known", this.service.counts().titles);
      this.logger.info("request", { requestId, method, path, durationMs: Math.round(duration) });
      this.limiter.prune();
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter((segment) => segment !== "");

    if (method === "GET" && url.pathname === "/health") {
      send(response, 200, await this.service.health(), requestId);
      return;
    }

    if (method === "GET" && url.pathname === "/metrics") {
      const text = this.metrics.render();
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4", "content-length": Buffer.byteLength(text) });
      response.end(text);
      return;
    }

    if (method === "GET" && url.pathname === "/openapi.json") {
      send(response, 200, openApiDocument(this.config), requestId);
      return;
    }

    if (url.pathname === "/titles") {
      if (method === "GET") {
        send(response, 200, { titles: this.service.listTitles() }, requestId);
        return;
      }
      if (method === "POST") {
        send(response, 201, await this.service.registerTitle(await readJson(request)), requestId);
        return;
      }
    }

    if (segments[0] === "titles" && segments[1] !== undefined) {
      const titleId = decodeURIComponent(segments[1]);
      const action = segments[2];

      if (method === "GET" && action === undefined) {
        send(response, 200, this.service.getTitle(titleId), requestId);
        return;
      }

      if (method === "GET" && action === "proof") {
        const minConfirmations = integerParam(url.searchParams.get("minConfirmations"), "minConfirmations");
        send(
          response,
          200,
          await this.service.buildProof(titleId, { ...(minConfirmations === undefined ? {} : { minConfirmations }) }),
          requestId,
        );
        return;
      }

      if (method === "GET" && action === "transfer-check") {
        const minConfirmations = integerParam(url.searchParams.get("minConfirmations"), "minConfirmations");
        send(
          response,
          200,
          await this.service.transferCheck(titleId, { ...(minConfirmations === undefined ? {} : { minConfirmations }) }),
          requestId,
        );
        return;
      }

      if (method === "GET" && action === "unbond-check") {
        const minConfirmations = integerParam(url.searchParams.get("minConfirmations"), "minConfirmations");
        send(
          response,
          200,
          await this.service.unbondCheck(titleId, { ...(minConfirmations === undefined ? {} : { minConfirmations }) }),
          requestId,
        );
        return;
      }

      if (method === "GET" && action === "revisions") {
        const limit = integerParam(url.searchParams.get("limit"), "limit") ?? 20;
        send(response, 200, { revisions: this.service.revisionHistory(titleId, Math.min(limit, 200)) }, requestId);
        return;
      }

      if (method === "POST" && action === "revisions") {
        const outcome = await this.service.acceptRevision(titleId);
        send(response, outcome.revision.status === "accepted" ? 201 : 409, outcome, requestId);
        return;
      }
    }

    if (method === "POST" && url.pathname === "/proofs/verify") {
      const body = await readJson(request);
      const requested = body["minConfirmations"];
      if (requested !== undefined && (!Number.isInteger(Number(requested)) || Number(requested) < 0)) {
        throw new HttpError(400, "INVALID_INPUT", "minConfirmations must be a non-negative integer");
      }
      send(
        response,
        200,
        await this.service.verifyProof({
          candidate: body["package"],
          ...(requested === undefined ? {} : { minConfirmations: Number(requested) }),
        }),
        requestId,
      );
      return;
    }

    if (method === "POST" && url.pathname === "/proofs/consume") {
      const outcome = this.service.consumeProof(await readJson(request));
      send(response, outcome.status === "consumed" ? 201 : 409, outcome, requestId);
      return;
    }

    throw new HttpError(404, "NOT_FOUND", `${method} ${url.pathname} is not a route of this service`);
  }
}
