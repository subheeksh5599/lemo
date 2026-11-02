// The service layer: one place where proof packages are produced, re-verified and
// decoded against a title's declared layout.

import type { Config } from "./config.ts";
import type { ChainIdentity, PortaldotChain } from "./chain/portaldot.ts";
import { buildPackage, verifyPackage, type ProofPackage, type VerifyReport } from "./proofs/package.ts";
import { decodeStorageValue, type DecodedValue, type FieldSpec } from "./storage/layout.ts";
import { bytes } from "./bytes.ts";
import { Store, type ConsumeOutcome } from "./store.ts";
import { BindingError, parseTitleBinding, revisionField, type TitleBinding } from "./titles/model.ts";

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export type FieldReading = {
  readonly label: string;
  readonly status: string;
  readonly decoded: DecodedValue | null;
  readonly note: string | null;
};

export type ProofResponse = {
  readonly package: ProofPackage;
  readonly revision: string | null;
  readonly readings: readonly FieldReading[];
  readonly report: VerifyReport;
};

export class ChainService {
  private readonly chain: PortaldotChain;
  private readonly store: Store;
  private readonly config: Config;

  constructor(input: { readonly chain: PortaldotChain; readonly store: Store; readonly config: Config }) {
    this.chain = input.chain;
    this.store = input.store;
    this.config = input.config;
  }

  async health(): Promise<{
    chain: ChainIdentity;
    finalized: { number: number; hash: string };
    head: number;
    rpcUrl: string;
    minConfirmations: number;
    latencyMs: number;
  }> {
    const startedAt = performance.now();
    const [identity, finalized, head] = await Promise.all([
      this.chain.describe(),
      this.chain.finalizedHead(),
      this.chain.headNumber(),
    ]);
    const latencyMs = Math.round(performance.now() - startedAt);

    return {
      chain: identity,
      finalized: { number: finalized.number, hash: finalized.hash },
      head,
      rpcUrl: this.config.rpcUrl,
      minConfirmations: this.config.minConfirmations,
      latencyMs,
    };
  }

  async registerTitle(candidate: unknown): Promise<TitleBinding> {
    const identity = await this.chain.describe();
    const binding = parseTitleBinding(candidate, identity.genesisHash);

    if (binding.fields.length > this.config.maxKeysPerPackage) {
      throw new BindingError(`a title may declare at most ${this.config.maxKeysPerPackage} fields`);
    }

    this.store.saveTitle(binding);
    return binding;
  }

  listTitles(): readonly TitleBinding[] {
    return this.store.listTitles();
  }

  getTitle(titleId: string): TitleBinding {
    const binding = this.store.getTitle(titleId);
    if (binding === null) throw new NotFoundError(`title ${titleId} is not registered by this service`);
    return binding;
  }

  async buildProof(titleId: string, options: { readonly minConfirmations?: number }): Promise<ProofResponse> {
    const binding = this.getTitle(titleId);
    const identity = await this.chain.describe();
    const built = await buildPackage({ chain: this.chain, identity, binding });

    const report = verifyPackage({
      package: built.package,
      headNumber: built.package.block.number,
      minConfirmations: 0,
      expectedGenesis: identity.genesisHash,
    });

    if (!report.valid) {
      throw new Error(`issued package failed its own verification: ${JSON.stringify(report.checks)}`);
    }

    const readings = this.read(binding, report);
    const revision = this.revisionOf(binding, readings);

    if (options.minConfirmations !== undefined) {
      const confirmations = (await this.chain.headNumber()) - built.package.block.number;
      if (confirmations < options.minConfirmations) {
        throw new RangeError(`the newest finalized block is ${confirmations} behind head, requested ${options.minConfirmations}`);
      }
    }

    return { package: built.package, revision, readings, report };
  }

  async verifyProof(options: { readonly candidate: unknown; readonly minConfirmations?: number }): Promise<
    VerifyReport & { readonly readings: readonly FieldReading[] }
  > {
    const headNumber = await this.chain.headNumber();
    const report = verifyPackage({
      package: options.candidate,
      headNumber,
      minConfirmations: options.minConfirmations ?? this.config.minConfirmations,
    });

    const declared = (options.candidate as { titleId?: unknown } | null)?.titleId;
    const binding = typeof declared === "string" ? this.store.getTitle(declared) : null;

    return { ...report, readings: binding === null ? [] : this.read(binding, report) };
  }

  consumeProof(body: Record<string, unknown>): ConsumeOutcome {
    const digest = body["digest"];
    const titleId = body["titleId"];
    const operation = body["operation"];

    if (typeof digest !== "string" || digest.startsWith("0x") === false || bytes.fromHex(digest).length !== 32) {
      throw new RangeError("digest must be 32 bytes of hex");
    }
    if (typeof titleId !== "string" || typeof operation !== "string" || operation === "") {
      throw new RangeError("titleId and a non-empty operation are required");
    }

    return this.store.consume(digest.toLowerCase(), titleId.toLowerCase(), operation);
  }

  close(): void {
    this.store.close();
  }

  private read(binding: TitleBinding, report: VerifyReport): FieldReading[] {
    return binding.fields.map((field) => {
      const entry = report.entries.find((candidate) => candidate.label === field.label);
      if (entry === undefined || entry.value === null) {
        return { label: field.label, status: entry?.status ?? "absent", decoded: null, note: null };
      }
      return decodeField(field, entry.status, entry.value);
    });
  }

  private revisionOf(binding: TitleBinding, readings: readonly FieldReading[]): string | null {
    const label = revisionField(binding).label;
    const reading = readings.find((entry) => entry.label === label);
    if (reading === undefined || reading.decoded === null) return null;
    return reading.decoded.kind === "integer" ? reading.decoded.value : null;
  }
}

function decodeField(field: FieldSpec, status: string, valueHex: string): FieldReading {
  try {
    return { label: field.label, status, decoded: decodeStorageValue(field, bytes.fromHex(valueHex)), note: null };
  } catch (cause) {
    return {
      label: field.label,
      status,
      decoded: null,
      note: `stored value did not decode as declared: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
