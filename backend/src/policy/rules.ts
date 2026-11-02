// The two rules LEMO is built on, evaluated from verified state only.
// A rule never returns "allowed" on missing data: an unanswered question is a
// refusal with a named reason.

import type { DecodedValue } from "../storage/layout.ts";
import type { FieldReading } from "../service.ts";
import type { VerifyReport } from "../proofs/package.ts";

export type RuleCheck = { readonly name: string; readonly ok: boolean; readonly detail: string };

export type RuleVerdict = {
  readonly rule: "transfer" | "unbond";
  readonly allowed: boolean;
  readonly checks: readonly RuleCheck[];
};

export type TransferInput = {
  readonly report: VerifyReport;
  readonly readings: readonly FieldReading[];
  readonly confirmations: number;
  readonly minConfirmations: number;
  readonly acceptedRevision: string | null;
};

export type UnbondInput = TransferInput & {
  readonly evmSupply: { readonly status: "read"; readonly value: bigint } | { readonly status: "unavailable"; readonly reason: string } | null;
};

const REQUIRED_FIELDS = ["revision", "owner", "backing"] as const;

function present(values: readonly FieldReading[], label: string): FieldReading | undefined {
  return values.find((reading) => reading.label === label && reading.status === "present");
}

function integerOf(reading: FieldReading | undefined): bigint | null {
  if (reading?.decoded?.kind !== "integer") return null;
  return BigInt(reading.decoded.value);
}

/** A title's revision must never move backwards: an older accepted revision stays authoritative. */
export function revisionMonotone(accepted: string | null, candidate: string | null): RuleCheck {
  if (candidate === null) return { name: "revision", ok: false, detail: "the package carries no readable revision" };
  if (accepted === null) return { name: "revision", ok: true, detail: `first accepted revision ${candidate}` };
  return BigInt(candidate) >= BigInt(accepted)
    ? { name: "revision", ok: true, detail: `revision ${candidate} is at or above the accepted ${accepted}` }
    : { name: "revision", ok: false, detail: `revision ${candidate} is older than the accepted ${accepted}` };
}

function baseChecks(input: TransferInput): RuleCheck[] {
  const checks: RuleCheck[] = [
    {
      name: "proof",
      ok: input.report.valid,
      detail: input.report.valid ? "package verified against its block state root" : "package failed verification",
    },
    revisionMonotone(input.acceptedRevision, revisionOf(input.readings)),
    {
      name: "freshness",
      ok: input.confirmations >= input.minConfirmations,
      detail: `${input.confirmations} block(s) behind head, required ${input.minConfirmations}`,
    },
  ];

  const missing = REQUIRED_FIELDS.filter((label) => present(input.readings, label) === undefined);
  checks.push({
    name: "records",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "every required record is present in the proof" : `missing or unproven: ${missing.join(", ")}`,
  });

  const undecodable = input.readings.filter((reading) => reading.status === "present" && reading.decoded === null);
  checks.push({
    name: "decoding",
    ok: undecodable.length === 0,
    detail: undecodable.length === 0 ? "every present record decoded as declared" : `did not decode: ${undecodable.map((r) => r.label).join(", ")}`,
  });

  const backing = integerOf(present(input.readings, "backing"));
  checks.push({
    name: "backing bound",
    ok: backing !== null && backing > 0n,
    detail: backing === null ? "backing amount is not an integer record" : backing > 0n ? `backing ${backing}` : "backing is zero: the title is unbound",
  });

  const identity = integerOf(present(input.readings, "identity"));
  checks.push({
    name: "identity",
    ok: identity === null ? true : identity > 0n,
    detail:
      identity === null
        ? "the title declares no identity record"
        : identity > 0n
          ? `identity status ${identity} holds`
          : "native identity is cleared, so the representation may not move",
  });

  return checks;
}

export function evaluateTransfer(input: TransferInput): RuleVerdict {
  const checks = baseChecks(input);
  return { rule: "transfer", allowed: checks.every((check) => check.ok), checks };
}

export function evaluateUnbond(input: UnbondInput): RuleVerdict {
  const checks = [...baseChecks(input)];

  if (input.evmSupply === null) {
    checks.push({ name: "representation", ok: false, detail: "the title declares no EVM representation to check" });
  } else if (input.evmSupply.status === "unavailable") {
    checks.push({
      name: "representation",
      ok: false,
      detail: `the EVM supply could not be read (${input.evmSupply.reason}); refusal is the only safe answer`,
    });
  } else {
    checks.push({
      name: "representation",
      ok: input.evmSupply.value === 0n,
      detail: input.evmSupply.value === 0n ? "no representation is outstanding" : `${input.evmSupply.value} unit(s) still circulate`,
    });
  }

  return { rule: "unbond", allowed: checks.every((check) => check.ok), checks };
}

function revisionOf(readings: readonly FieldReading[]): string | null {
  const reading = present(readings, "revision");
  if (reading?.decoded?.kind !== "integer") return null;
  return reading.decoded.value;
}

export function decodedLabel(readings: readonly FieldReading[], label: string): DecodedValue | null {
  return present(readings, label)?.decoded ?? null;
}
