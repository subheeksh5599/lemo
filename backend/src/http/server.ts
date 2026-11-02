// HTTP surface. Every read is public; nothing here mutates chain state. The one
// write is consuming a proof digest, which is the service's own replay record.

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { Config } from "../config.ts";
import { NotFoundError, type ChainService } from "../service.ts";
import { BindingError } from "../titles/model.ts";

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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) throw new HttpError(413, "BODY_TOO_LARGE", "request body exceeds 2 MiB");
    chunks.push(buffer);
  }

  if (total === 0) throw new HttpError(400, "EMPTY_BODY", "a JSON body is required");

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "BAD_JSON", "body is not valid JSON");
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
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

export class HttpServer {
  private readonly server: Server;
  private readonly service: ChainService;
  private readonly config: Config;

  constructor(input: { readonly service: ChainService; readonly config: Config }) {
    this.service = input.service;
    this.config = input.config;
    this.server = createServer((request, response) => {
      this.route(request, response).catch((cause: unknown) => {
        const failure = describeFailure(cause);
        send(response, failure.status, { error: { code: failure.code, message: failure.message } });
      });
    });
  }

  listen(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.config.port, "127.0.0.1", () => {
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

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter((segment) => segment !== "");

    if (method === "GET" && url.pathname === "/health") {
      send(response, 200, await this.service.health());
      return;
    }

    if (url.pathname === "/titles" && method === "GET") {
      send(response, 200, { titles: this.service.listTitles() });
      return;
    }

    if (url.pathname === "/titles" && method === "POST") {
      send(response, 201, await this.service.registerTitle(await readJson(request)));
      return;
    }

    if (segments[0] === "titles" && segments[1] !== undefined && method === "GET") {
      const titleId = decodeURIComponent(segments[1]);

      if (segments.length === 2) {
        send(response, 200, this.service.getTitle(titleId));
        return;
      }

      if (segments.length === 3 && segments[2] === "proof") {
        const requested = url.searchParams.get("minConfirmations");
        if (requested !== null && !Number.isInteger(Number(requested))) {
          throw new HttpError(400, "INVALID_INPUT", "minConfirmations must be an integer");
        }
        send(
          response,
          200,
          await this.service.buildProof(titleId, {
            ...(requested === null ? {} : { minConfirmations: Number(requested) }),
          }),
        );
        return;
      }
    }

    if (method === "POST" && url.pathname === "/proofs/verify") {
      const body = await readJson(request);
      if (typeof body !== "object" || body === null) throw new HttpError(400, "BAD_JSON", "body must be an object");
      const record = body as Record<string, unknown>;
      const requested = record["minConfirmations"];
      if (requested !== undefined && !Number.isInteger(Number(requested))) {
        throw new HttpError(400, "INVALID_INPUT", "minConfirmations must be an integer");
      }
      send(
        response,
        200,
        await this.service.verifyProof({
          candidate: record["package"],
          ...(requested === undefined ? {} : { minConfirmations: Number(requested) }),
        }),
      );
      return;
    }

    if (method === "POST" && url.pathname === "/proofs/consume") {
      const body = await readJson(request);
      if (typeof body !== "object" || body === null) throw new HttpError(400, "BAD_JSON", "body must be an object");
      const outcome = this.service.consumeProof(body as Record<string, unknown>);
      send(response, outcome.status === "consumed" ? 201 : 409, outcome);
      return;
    }

    throw new HttpError(404, "NOT_FOUND", `${method} ${url.pathname} is not a route of this service`);
  }
}
