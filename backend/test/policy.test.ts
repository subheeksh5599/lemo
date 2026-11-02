import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTransfer, evaluateUnbond } from "../src/policy/rules.ts";
import type { FieldReading } from "../src/service.ts";
import type { VerifyReport } from "../src/proofs/package.ts";

const validReport: VerifyReport = {
  valid: true,
  digest: `0x${"11".repeat(32)}`,
  checks: [{ name: "state root", ok: true, detail: "ok" }],
  entries: [],
  revision: "5",
};

const readings = (overrides: Partial<Record<string, FieldReading>> = {}): FieldReading[] => {
  const base: FieldReading[] = [
    { label: "revision", status: "present", decoded: { kind: "integer", value: "5" }, note: null },
    { label: "owner", status: "present", decoded: { kind: "bytes", hex: "0x01" }, note: null },
    { label: "backing", status: "present", decoded: { kind: "integer", value: "100" }, note: null },
  ];

  const merged = new Map<string, FieldReading>(base.map((entry) => [entry.label, entry]));
  for (const [label, reading] of Object.entries(overrides)) {
    if (reading !== undefined) merged.set(label, reading);
  }
  return [...merged.values()];
};

const base = {
  report: validReport,
  readings: readings(),
  confirmations: 12,
  minConfirmations: 6,
  acceptedRevision: "5",
};

test("Rule 1 allows a transfer when every record verifies and the revision is current", () => {
  const verdict = evaluateTransfer(base);
  assert.equal(verdict.allowed, true, JSON.stringify(verdict.checks));
  assert.equal(verdict.rule, "transfer");
});

test("Rule 1 refuses an older revision than the one already accepted", () => {
  const verdict = evaluateTransfer({ ...base, readings: readings({ revision: { label: "revision", status: "present", decoded: { kind: "integer", value: "4" }, note: null } }) });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.checks.find((check) => check.name === "revision")?.ok, false);
});

test("Rule 1 refuses when native identity is cleared", () => {
  const verdict = evaluateTransfer({
    ...base,
    readings: readings({ identity: { label: "identity", status: "present", decoded: { kind: "integer", value: "0" }, note: null } }),
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.checks.find((check) => check.name === "identity")?.ok, false);
});

test("Rule 1 refuses when the backing record is absent from the proof", () => {
  const withoutBacking = readings().filter((entry) => entry.label !== "backing");
  const verdict = evaluateTransfer({ ...base, readings: withoutBacking });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.checks.find((check) => check.name === "records")?.ok, false);
});

test("Rule 1 refuses on an unverified proof even when every record looks correct", () => {
  const verdict = evaluateTransfer({ ...base, report: { ...validReport, valid: false } });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.checks.find((check) => check.name === "proof")?.ok, false);
});

test("Rule 1 refuses a package that is shallower than the required depth", () => {
  const verdict = evaluateTransfer({ ...base, confirmations: 1 });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.checks.find((check) => check.name === "freshness")?.ok, false);
});

test("Rule 2 allows unlocking only when no representation is outstanding", () => {
  const allowed = evaluateUnbond({ ...base, evmSupply: { status: "read", value: 0n } });
  assert.equal(allowed.allowed, true, JSON.stringify(allowed.checks));

  const outstanding = evaluateUnbond({ ...base, evmSupply: { status: "read", value: 1n } });
  assert.equal(outstanding.allowed, false);
  assert.equal(outstanding.checks.find((check) => check.name === "representation")?.ok, false);
});

test("Rule 2 refuses when the EVM supply cannot be read, rather than assuming zero", () => {
  const verdict = evaluateUnbond({ ...base, evmSupply: { status: "unavailable", reason: "no eth_ namespace" } });
  assert.equal(verdict.allowed, false);
  const check = verdict.checks.find((entry) => entry.name === "representation");
  assert.match(check?.detail ?? "", /could not be read/);
});

test("Rule 2 refuses a title that declares no representation at all", () => {
  const verdict = evaluateUnbond({ ...base, evmSupply: null });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.checks.find((entry) => entry.name === "representation")?.detail ?? "", /declares no EVM representation/);
});
