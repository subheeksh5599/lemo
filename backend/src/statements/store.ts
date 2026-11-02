// Statement Store client: the public noticeboard LEMO uses to announce a title hash.
// Gossip is best effort and carries no authority, so every answer here is explicit
// about whether the node accepted the statement, refused it, or lacks the method.

export type SubmitOutcome =
  | { readonly status: "queued"; readonly bytes: number }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string };

export type Topic = string;

const METHODS = ["statement_submit", "statement_subscribeStatement"] as const;

export class StatementStore {
  private readonly url: string;
  private readonly timeoutMs: number;
  private support: boolean | null = null;

  constructor(input: { readonly url: string; readonly timeoutMs: number }) {
    this.url = input.url;
    this.timeoutMs = input.timeoutMs;
  }

  async supported(): Promise<boolean> {
    if (this.support !== null) return this.support;

    try {
      const methods = await this.call<string[]>("rpc_methods", []);
      this.support = methods.includes("statement_submit");
    } catch {
      // A transport failure says nothing about the method set: leave it unknown so the
      // next call asks again instead of caching a false negative.
      return false;
    }
    return this.support;
  }

  /** Announces one title hash on `lemo/<title_id>`; the payload is bound to the title and revision. */
  async announce(input: {
    readonly titleId: string;
    readonly revision: string;
    readonly digest: string;
    readonly blockNumber: number;
  }): Promise<SubmitOutcome> {
    if (!(await this.supported())) {
      return { status: "unsupported", reason: "the node does not expose statement_submit" };
    }

    const payload = JSON.stringify({
      topic: topicFor(input.titleId),
      titleId: input.titleId,
      revision: input.revision,
      digest: input.digest,
      block: input.blockNumber,
      at: new Date().toISOString(),
    });
    const encoded = `0x${Buffer.from(payload, "utf8").toString("hex")}`;

    try {
      const result = await this.call<{ ok?: boolean; error?: string } | boolean>("statement_submit", [encoded]);
      const accepted = typeof result === "boolean" ? result : result.ok === true;

      if (accepted) return { status: "queued", bytes: payload.length };
      const reason = typeof result === "object" && result.error !== undefined ? String(result.error) : "node refused the statement";
      return { status: "rejected", reason };
    } catch (cause) {
      return { status: "rejected", reason: cause instanceof Error ? cause.message : "statement_submit failed" };
    }
  }

  topicFor(titleId: string): Topic {
    return topicFor(titleId);
  }

  private async call<T>(method: string, params: readonly unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`http ${response.status} from ${method}`);

    const body = (await response.json()) as { result?: T; error?: { message?: string } };
    if (body.error !== undefined) throw new Error(body.error.message ?? `${method} failed`);
    if (body.result === undefined) throw new Error(`${method} returned no result`);
    return body.result;
  }
}

export function topicFor(titleId: string): Topic {
  return `lemo/${titleId.toLowerCase()}`;
}

export const STATEMENT_METHODS = METHODS;
