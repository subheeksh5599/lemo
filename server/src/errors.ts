/**
 * Error taxonomy for the HTTP layer.
 *
 * Every refusal a client can receive has a stable `code`, and the HTTP status
 * carries the same meaning. Nothing internal (stack traces, upstream payloads)
 * is put in `message`; upstream text belongs in `details.upstream`.
 */

export type ErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "STALE_PROOF"
  | "PROOF_UNVERIFIED"
  | "UPSTREAM_ERROR"
  | "CHAIN_MISMATCH"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details ?? null;
  }

  static invalid(message: string, details?: unknown): AppError {
    return new AppError("INVALID_REQUEST", 400, message, details);
  }

  static notFound(message: string, details?: unknown): AppError {
    return new AppError("NOT_FOUND", 404, message, details);
  }

  static stale(message: string, details?: unknown): AppError {
    return new AppError("STALE_PROOF", 409, message, details);
  }

  static unverified(message: string, details?: unknown): AppError {
    return new AppError("PROOF_UNVERIFIED", 502, message, details);
  }

  static upstream(message: string, details?: unknown): AppError {
    return new AppError("UPSTREAM_ERROR", 502, message, details);
  }

  static internal(message: string, details?: unknown): AppError {
    return new AppError("INTERNAL", 500, message, details);
  }
}

/** Turns a caught value into a message without leaking a stack. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
