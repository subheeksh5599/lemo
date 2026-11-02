// A title binding is the declaration of which chain records make up one LEMO
// title. It carries no ownership authority: it only names the storage keys whose
// proof is served, so a verifier can check the same keys against the same root.

import { bytes } from "../bytes.ts";
import { HASHERS, type ArgSpec, type DecodeType, type FieldSpec, type Hasher } from "../storage/layout.ts";

export type TitleBinding = {
  readonly titleId: string;
  readonly label: string;
  readonly genesisHash: string;
  readonly fields: readonly FieldSpec[];
};

export const REVISION_LABEL = "revision";

export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingError";
  }
}

const ARG_TYPES = new Set(["vec", "account32", "hash32", "u32", "u64", "u128"]);
const DECODE_TYPES = new Set(["bytes", "u32", "u64", "u128"]);

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new BindingError(`${key} must be a non-empty string`);
  return value;
}

function parseArg(input: unknown, fieldLabel: string): ArgSpec {
  if (typeof input !== "object" || input === null) throw new BindingError(`${fieldLabel}: each arg needs type and value`);
  const record = input as Record<string, unknown>;
  const type = requireString(record, "type");
  if (!ARG_TYPES.has(type)) throw new BindingError(`${fieldLabel}: unknown arg type ${type}`);
  return { type: type as ArgSpec["type"], value: requireString(record, "value") };
}

function parseField(input: unknown): FieldSpec {
  if (typeof input !== "object" || input === null) throw new BindingError("each field must be an object");
  const record = input as Record<string, unknown>;
  const label = requireString(record, "label");

  const hasher = requireString(record, "hasher");
  if (!(HASHERS as readonly string[]).includes(hasher)) throw new BindingError(`${label}: unknown hasher ${hasher}`);

  const decode = requireString(record, "decode");
  if (!DECODE_TYPES.has(decode)) throw new BindingError(`${label}: unknown decode type ${decode}`);

  const rawArgs = record["args"] ?? [];
  if (!Array.isArray(rawArgs)) throw new BindingError(`${label}: args must be an array`);

  return {
    label,
    pallet: requireString(record, "pallet"),
    item: requireString(record, "item"),
    hasher: hasher as Hasher,
    args: rawArgs.map((arg) => parseArg(arg, label)),
    decode: decode as DecodeType,
  };
}

export function parseTitleBinding(input: unknown, genesisHash: string): TitleBinding {
  if (typeof input !== "object" || input === null) throw new BindingError("body must be a JSON object");
  const record = input as Record<string, unknown>;

  const titleId = requireString(record, "titleId").toLowerCase();
  if (titleId.startsWith("0x") === false || bytes.fromHex(titleId).length !== 32) {
    throw new BindingError("titleId must be 32 bytes of hex");
  }

  const rawFields = record["fields"];
  if (!Array.isArray(rawFields) || rawFields.length === 0) throw new BindingError("fields must be a non-empty array");

  const fields = rawFields.map(parseField);

  const labels = new Set<string>();
  for (const field of fields) {
    if (labels.has(field.label)) throw new BindingError(`duplicate field label ${field.label}`);
    labels.add(field.label);
  }

  const revisionField = fields.find((field) => field.label === REVISION_LABEL);
  if (revisionField === undefined) throw new BindingError(`exactly one field must be named "${REVISION_LABEL}"`);
  if (revisionField.decode !== "u32" && revisionField.decode !== "u64") {
    throw new BindingError(`"${REVISION_LABEL}" must decode as u32 or u64`);
  }

  return {
    titleId,
    label: typeof record["label"] === "string" && record["label"] !== "" ? record["label"] : titleId,
    genesisHash,
    fields,
  };
}

export function revisionField(binding: TitleBinding): FieldSpec {
  const field = binding.fields.find((candidate) => candidate.label === REVISION_LABEL);
  if (field === undefined) throw new BindingError(`binding ${binding.titleId} has no revision field`);
  return field;
}
