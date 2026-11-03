/**
 * RPC provider URLs very often carry an API key in the path, query or userinfo
 * (`https://rpc.example/v2/<key>`, `https://user:key@rpc.example`). Anything
 * that leaves the process — a response body, an error message, a log line —
 * gets the origin only, plus a flag saying whether something was stripped.
 */

export type RedactedUrl = {
  /** Scheme, host and port only. */
  readonly url: string;
  /** True when a path, query, fragment or userinfo was present and removed. */
  readonly hasCredentials: boolean;
};

export function redactUrl(raw: string): RedactedUrl {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    // Never echo something we cannot parse: it may be the secret itself.
    return { url: "(unparseable url)", hasCredentials: true };
  }

  const hasCredentials =
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== "";

  // `URL#origin` is the string "null" for non-special schemes; build it by hand.
  const url = `${parsed.protocol}//${parsed.host}`;

  return { url, hasCredentials };
}

/** The origin alone, for error messages and logs. */
export function redactedOrigin(raw: string): string {
  return redactUrl(raw).url;
}
