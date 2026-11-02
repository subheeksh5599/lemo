// Proof packages: the unit this service hands out. A package is only useful if it
// verifies against a block's own state root, so every package is self-checked
// before it leaves the process and re-checked when it comes back in.

import { bytes } from "../bytes.ts";
import type { ChainIdentity, Header, PortaldotChain } from "../chain/portaldot.ts";
import { hash } from "../hashing.ts";
import { storageKey, type FieldSpec } from "../storage/layout.ts";
import { openProof, ProofError } from "../trie/proof.ts";
import { revisionField, type TitleBinding } from "../titles/model.ts";

export const PACKAGE_VERSION = 1;

export type ProofPackage = {
  readonly version: number;
  readonly titleId: string;
  readonly chain: { readonly name: string; readonly genesisHash: string };
  readonly block: { readonly number: number; readonly hash: string; readonly parentHash: string; readonly stateRoot: string };
  readonly keys: readonly { readonly label: string; readonly key: string }[];
  readonly proof: readonly string[];
  readonly digest: string;
  readonly builtAt: string;
};

export type PackageDigestInput = Omit<ProofPackage, "digest" | "builtAt">;

/** Canonical form: fixed field order, no whitespace, so two peers digest identically. */
export function canonical(input: PackageDigestInput): string {
  return JSON.stringify([
    input.version,
    input.titleId,
    input.chain.name,
    input.chain.genesisHash,
    input.block.number,
    input.block.hash,
    input.block.parentHash,
    input.block.stateRoot,
    input.keys.map((entry) => [entry.label, entry.key]),
    input.proof,
  ]);
}

export function digestOf(input: PackageDigestInput): string {
  return bytes.toHex(hash.blake2b256(new TextEncoder().encode(canonical(input))));
}

export type BuildResult = {
  readonly package: ProofPackage;
  readonly entries: readonly { readonly label: string; readonly status: string; readonly field: FieldSpec }[];
};

export class SelfCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfCheckError";
  }
}

export async function buildPackage(input: {
  readonly chain: PortaldotChain;
  readonly identity: ChainIdentity;
  readonly binding: TitleBinding;
  readonly at?: Header;
}): Promise<BuildResult> {
  const { chain, identity, binding } = input;
  const head = input.at ?? (await chain.finalizedHead());

  if (binding.genesisHash !== identity.genesisHash) {
    throw new SelfCheckError(
      `title ${binding.titleId} is bound to genesis ${binding.genesisHash}, this node serves ${identity.genesisHash}`,
    );
  }

  const keys = binding.fields.map((field) => ({ label: field.label, key: storageKey(field) }));
  const proof = await chain.readProof(
    keys.map((entry) => bytes.toHex(entry.key)),
    head.hash,
  );

  const opened = openProof(proof.nodes, bytes.fromHex(head.stateRoot));
  if (proof.at !== head.hash) {
    throw new SelfCheckError(`node answered the proof at ${proof.at}, not at the finalized block ${head.hash}`);
  }

  const statuses = keys.map((entry) => ({ label: entry.label, status: opened.lookup(entry.key).status }));

  const incomplete = statuses.find((entry) => entry.status === "incomplete");
  if (incomplete !== undefined) {
    throw new SelfCheckError(`proof is incomplete for ${incomplete.label}; the node did not return the value node`);
  }

  const body: PackageDigestInput = {
    version: PACKAGE_VERSION,
    titleId: binding.titleId,
    chain: { name: identity.name, genesisHash: identity.genesisHash },
    block: {
      number: head.number,
      hash: head.hash,
      parentHash: head.parentHash,
      stateRoot: head.stateRoot,
    },
    keys: keys.map((entry) => ({ label: entry.label, key: bytes.toHex(entry.key) })),
    proof: proof.nodes.map((node) => bytes.toHex(node)),
  };

  const entries = binding.fields.map((field, position) => ({
    label: field.label,
    status: statuses[position]?.status ?? "absent",
    field,
  }));

  return {
    package: { ...body, digest: digestOf(body), builtAt: new Date().toISOString() },
    entries,
  };
}

export type VerifyCheck = { readonly name: string; readonly ok: boolean; readonly detail: string };

export type VerifyReport = {
  readonly valid: boolean;
  readonly digest: string | null;
  readonly checks: readonly VerifyCheck[];
  readonly entries: readonly { readonly label: string; readonly status: string; readonly value: string | null }[];
  readonly revision: string | null;
};

export function verifyPackage(input: {
  readonly package: unknown;
  readonly headNumber: number;
  readonly minConfirmations: number;
  readonly expectedGenesis?: string;
}): VerifyReport {
  const parsed = parsePackage(input.package);
  if (parsed === null) {
    return {
      valid: false,
      digest: null,
      checks: [{ name: "shape", ok: false, detail: "not a version 1 proof package" }],
      entries: [],
      revision: null,
    };
  }

  const checks: VerifyCheck[] = [];
  const recomputed = digestOf(parsed);

  checks.push({
    name: "digest",
    ok: recomputed === parsed.digest,
    detail: recomputed === parsed.digest ? "package digest matches its contents" : `digest ${recomputed} does not match ${parsed.digest}`,
  });

  if (input.expectedGenesis !== undefined) {
    checks.push({
      name: "chain",
      ok: parsed.chain.genesisHash === input.expectedGenesis,
      detail:
        parsed.chain.genesisHash === input.expectedGenesis
          ? `bound to genesis ${parsed.chain.genesisHash}`
          : `package is for genesis ${parsed.chain.genesisHash}, expected ${input.expectedGenesis}`,
    });
  }

  const confirmations = input.headNumber - parsed.block.number;
  checks.push({
    name: "finality",
    ok: confirmations >= input.minConfirmations,
    detail:
      confirmations < 0
        ? `block ${parsed.block.number} is ahead of the node head ${input.headNumber}`
        : `${confirmations} block(s) behind the node head, required ${input.minConfirmations}`,
  });

  const entries: { label: string; status: string; value: string | null }[] = [];
  try {
    const opened = openProof(parsed.proof.map((node) => bytes.fromHex(node)), bytes.fromHex(parsed.block.stateRoot));
    checks.push({ name: "state root", ok: true, detail: `proof reaches root ${parsed.block.stateRoot}` });

    for (const entry of parsed.keys) {
      const lookup = opened.lookup(bytes.fromHex(entry.key));
      const value = lookup.status === "present" ? bytes.toHex(lookup.value) : null;
      entries.push({ label: entry.label, status: lookup.status, value });
    }

    const allResolved = entries.every((entry) => entry.status !== "incomplete");
    checks.push({
      name: "coverage",
      ok: allResolved,
      detail: allResolved ? `every key in the package is covered by the proof` : "a key needed a node the proof does not carry",
    });
  } catch (cause) {
    const detail = cause instanceof ProofError ? `${cause.code}: ${cause.message}` : String(cause);
    checks.push({ name: "state root", ok: false, detail });
  }

  const revisionEntry = entries.find((entry) => entry.label === "revision");
  const revision = revisionEntry?.value ?? null;

  return {
    valid: checks.every((check) => check.ok),
    digest: parsed.digest,
    checks,
    entries,
    revision,
  };
}

function parsePackage(input: unknown): ProofPackage | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;

  if (record["version"] !== PACKAGE_VERSION) return null;
  if (typeof record["titleId"] !== "string" || typeof record["digest"] !== "string") return null;
  if (typeof record["builtAt"] !== "string") return null;

  const chain = record["chain"] as { name?: unknown; genesisHash?: unknown } | undefined;
  const block = record["block"] as Record<string, unknown> | undefined;
  if (chain === undefined || block === undefined) return null;
  if (typeof chain.name !== "string" || typeof chain.genesisHash !== "string") return null;

  const number = block["number"];
  if (typeof number !== "number" || !Number.isInteger(number)) return null;
  const blockFields = ["hash", "parentHash", "stateRoot"] as const;
  for (const field of blockFields) if (typeof block[field] !== "string") return null;

  if (!Array.isArray(record["keys"]) || !Array.isArray(record["proof"])) return null;
  const keys: { label: string; key: string }[] = [];
  for (const entry of record["keys"]) {
    if (typeof entry !== "object" || entry === null) return null;
    const pair = entry as Record<string, unknown>;
    if (typeof pair["label"] !== "string" || typeof pair["key"] !== "string") return null;
    keys.push({ label: pair["label"], key: pair["key"] });
  }
  const proof: string[] = [];
  for (const node of record["proof"]) {
    if (typeof node !== "string") return null;
    proof.push(node);
  }

  return {
    version: PACKAGE_VERSION,
    titleId: record["titleId"],
    chain: { name: chain.name, genesisHash: chain.genesisHash },
    block: {
      number,
      hash: block["hash"] as string,
      parentHash: block["parentHash"] as string,
      stateRoot: block["stateRoot"] as string,
    },
    keys,
    proof,
    digest: record["digest"],
    builtAt: record["builtAt"],
  };
}
