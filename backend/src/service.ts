// The service layer: proof packages are produced, re-verified, decoded against a title's
// layout, and then handed to the two rules that decide what may happen next.

import type { Config } from "./config.ts";
import type { ChainIdentity, PortaldotChain } from "./chain/portaldot.ts";
import type { EvmClient, TokenRead } from "./chain/evm.ts";
import type { StatementStore, SubmitOutcome } from "./statements/store.ts";
import { buildPackage, verifyPackage, type ProofPackage, type VerifyReport } from "./proofs/package.ts";
import { decodeStorageValue, type DecodedValue, type FieldSpec } from "./storage/layout.ts";
import { bytes } from "./bytes.ts";
import { Store, type ConsumeOutcome, type RevisionOutcome } from "./store.ts";
import { BindingError, parseTitleBinding, revisionField, type TitleBinding } from "./titles/model.ts";
import { evaluateTransfer, evaluateUnbond, type RuleVerdict } from "./policy/rules.ts";
import type { Metrics } from "./observability/telemetry.ts";

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

export type RuleResponse = {
  readonly titleId: string;
  readonly revision: string | null;
  readonly digest: string;
  readonly block: { readonly number: number; readonly hash: string };
  readonly verdict: RuleVerdict;
  readonly readings: readonly FieldReading[];
  readonly representation: TokenRead | null;
};

export class ChainService {
  private readonly chain: PortaldotChain;
  private readonly store: Store;
  private readonly config: Config;
  private readonly evm: EvmClient | null;
  private readonly statements: StatementStore | null;
  private readonly metrics: Metrics | null;

  constructor(input: {
    readonly chain: PortaldotChain;
    readonly store: Store;
    readonly config: Config;
    readonly evm?: EvmClient | null;
    readonly statements?: StatementStore | null;
    readonly metrics?: Metrics | null;
  }) {
    this.chain = input.chain;
    this.store = input.store;
    this.config = input.config;
    this.evm = input.evm ?? null;
    this.statements = input.statements ?? null;
    this.metrics = input.metrics ?? null;
  }

  async health(): Promise<{
    chain: ChainIdentity;
    finalized: { number: number; hash: string };
    head: number;
    rpcUrl: string;
    minConfirmations: number;
    latencyMs: number;
    evm: { available: boolean; chainId: number | null; reason: string | null };
    statements: { available: boolean; topicPrefix: string };
    counts: { titles: number; acceptedRevisions: number; consumedProofs: number };
  }> {
    const startedAt = performance.now();
    const [identity, finalized, head] = await Promise.all([
      this.chain.describe(),
      this.chain.finalizedHead(),
      this.chain.headNumber(),
    ]);
    const latencyMs = Math.round(performance.now() - startedAt);

    const evm = this.evm === null ? null : await this.evm.capabilities();
    const statements = this.statements === null ? false : await this.statements.supported();

    return {
      chain: identity,
      finalized: { number: finalized.number, hash: finalized.hash },
      head,
      rpcUrl: this.config.rpcUrl,
      minConfirmations: this.config.minConfirmations,
      latencyMs,
      evm:
        evm === null
          ? { available: false, chainId: null, reason: "no EVM RPC configured" }
          : evm.available
            ? { available: true, chainId: evm.chainId, reason: null }
            : { available: false, chainId: null, reason: evm.reason },
      statements: { available: statements, topicPrefix: "lemo/<title_id>" },
      counts: this.store.counts(),
    };
  }

  async registerTitle(candidate: unknown): Promise<TitleBinding> {
    const identity = await this.chain.describe();
    const binding = parseTitleBinding(candidate, identity.genesisHash);

    if (binding.fields.length > this.config.maxFields) {
      throw new BindingError(`a title may declare at most ${this.config.maxFields} fields`);
    }

    this.store.saveTitle(binding);
    this.metrics?.increment("titles_registered");
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

    if (!report.valid) throw new Error(`issued package failed its own verification: ${JSON.stringify(report.checks)}`);

    if (options.minConfirmations !== undefined) {
      const confirmations = (await this.chain.headNumber()) - built.package.block.number;
      if (confirmations < options.minConfirmations) {
        throw new RangeError(`the newest finalized block is ${confirmations} behind head, requested ${options.minConfirmations}`);
      }
    }

    const readings = this.read(binding, report);
    this.metrics?.increment("packages_built");

    return { package: built.package, revision: this.revisionOf(binding, readings), readings, report };
  }

  async verifyProof(options: { readonly candidate: unknown; readonly minConfirmations?: number }): Promise<
    VerifyReport & { readonly readings: readonly FieldReading[]; readonly verdict: RuleVerdict }
  > {
    const headNumber = await this.chain.headNumber();
    const report = verifyPackage({
      package: options.candidate,
      headNumber,
      minConfirmations: options.minConfirmations ?? this.config.minConfirmations,
    });

    const declared = (options.candidate as { titleId?: unknown } | null)?.titleId;
    const binding = typeof declared === "string" ? this.store.getTitle(declared) : null;
    const readings = binding === null ? [] : this.read(binding, report);

    this.metrics?.increment(report.valid ? "packages_verified" : "packages_rejected");

    const verdict = evaluateTransfer({
      report,
      readings,
      confirmations: headNumber - (report.checks.length === 0 ? headNumber : blockNumberOf(options.candidate, headNumber)),
      minConfirmations: options.minConfirmations ?? this.config.minConfirmations,
      acceptedRevision: binding === null ? null : this.store.acceptedRevision(binding.titleId),
    });

    return { ...report, readings, verdict };
  }

  /** Rule 1: may the EVM representation move on this title state? */
  async transferCheck(titleId: string, options: { readonly minConfirmations?: number }): Promise<RuleResponse> {
    const built = await this.buildProof(titleId, options);
    const headNumber = await this.chain.headNumber();
    const confirmations = headNumber - built.package.block.number;

    const verdict = evaluateTransfer({
      report: built.report,
      readings: built.readings,
      confirmations,
      minConfirmations: options.minConfirmations ?? this.config.minConfirmations,
      acceptedRevision: this.store.acceptedRevision(titleId),
    });

    this.metrics?.increment(verdict.allowed ? "transfer_allowed" : "transfer_refused");

    return {
      titleId: titleId.toLowerCase(),
      revision: built.revision,
      digest: built.package.digest,
      block: { number: built.package.block.number, hash: built.package.block.hash },
      verdict,
      readings: built.readings,
      representation: null,
    };
  }

  /** Rule 2: may the native backing be unlocked? Refuses when the EVM supply cannot be read. */
  async unbondCheck(titleId: string, options: { readonly minConfirmations?: number }): Promise<RuleResponse> {
    const binding = this.getTitle(titleId);
    const built = await this.buildProof(titleId, options);
    const headNumber = await this.chain.headNumber();

    const representation = await this.readRepresentation(binding);
    const verdict = evaluateUnbond({
      report: built.report,
      readings: built.readings,
      confirmations: headNumber - built.package.block.number,
      minConfirmations: options.minConfirmations ?? this.config.minConfirmations,
      acceptedRevision: this.store.acceptedRevision(titleId),
      evmSupply: representation,
    });

    this.metrics?.increment(verdict.allowed ? "unbond_allowed" : "unbond_refused");

    return {
      titleId: titleId.toLowerCase(),
      revision: built.revision,
      digest: built.package.digest,
      block: { number: built.package.block.number, hash: built.package.block.hash },
      verdict,
      readings: built.readings,
      representation,
    };
  }

  /** Records a verified revision as accepted and announces the title hash on its topic. */
  async acceptRevision(titleId: string): Promise<{
    readonly revision: RevisionOutcome;
    readonly announcement: SubmitOutcome;
  }> {
    const built = await this.buildProof(titleId, {});
    if (built.revision === null) throw new RangeError(`title ${titleId} produced no readable revision`);

    const revision = this.store.acceptRevision({
      titleId,
      revision: built.revision,
      digest: built.package.digest,
      blockNumber: built.package.block.number,
    });

    if (revision.status === "stale") {
      this.metrics?.increment("revision_refused");
      return { revision, announcement: { status: "rejected", reason: "stale revision is not announced" } };
    }

    this.metrics?.increment("revision_accepted");
    const announcement =
      this.statements === null
        ? ({ status: "unsupported", reason: "no statement store configured" } as const)
        : await this.statements.announce({
            titleId,
            revision: built.revision,
            digest: built.package.digest,
            blockNumber: built.package.block.number,
          });

    return { revision, announcement };
  }

  revisionHistory(titleId: string, limit = 20): readonly { revision: string; digest: string; blockNumber: number; acceptedAt: string }[] {
    this.getTitle(titleId);
    return this.store.revisionHistory(titleId, limit);
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

    const outcome = this.store.consume(digest.toLowerCase(), titleId.toLowerCase(), operation);
    this.metrics?.increment(outcome.status === "consumed" ? "digests_consumed" : "digests_replayed");
    return outcome;
  }

  counts(): { titles: number; acceptedRevisions: number; consumedProofs: number } {
    return this.store.counts();
  }

  close(): void {
    this.store.close();
  }

  private async readRepresentation(binding: TitleBinding): Promise<TokenRead | null> {
    if (binding.evm === null) return null;
    if (this.evm === null) return { status: "unavailable", reason: "no EVM RPC configured" };
    if (binding.evm.standard === "erc20") return this.evm.totalSupply(binding.evm.contract);
    return this.evm.codeSize(binding.evm.contract);
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

function blockNumberOf(candidate: unknown, fallback: number): number {
  const block = (candidate as { block?: { number?: unknown } } | null)?.block?.number;
  return typeof block === "number" && Number.isInteger(block) ? block : fallback;
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
