import type { Config } from "./config.ts";
import { AppError, messageOf } from "./errors.ts";
import { verifyStorageProof, type ProofResult } from "./proofs/trie.ts";
import { decodeStorageValue, type DecodedValue } from "./proofs/values.ts";
import { isMethodNotFound, RpcError } from "./rpc/jsonRpc.ts";
import type { EvmClient } from "./rpc/evm.ts";
import type { Hex, SubstrateClient } from "./rpc/substrate.ts";
import type {
  AtInput,
  EvmWitnessData,
  HealthData,
  NativeWitnessData,
  NetworkData,
  ReadsData,
  VerifyNativeData,
} from "./schemas.ts";
import { asHex } from "./util/bytes.ts";

export type ProofServiceOptions = {
  readonly config: Config;
  readonly substrate: SubstrateClient;
  readonly evm: EvmClient;
};

/** A resolved block with the hash types the verifier needs. */
export type ResolvedBlock = {
  readonly hash: Hex;
  readonly number: number;
  readonly parentHash: Hex;
  readonly stateRoot: Hex;
  readonly finalized: boolean;
  readonly ageBlocks: number;
};

export type StartupIdentity = {
  readonly chain: string;
  readonly chainType: string;
  readonly genesisHash: Hex;
  readonly evmChainId: number;
  /** The head every proof will be anchored to; it must exist before serving. */
  readonly finalizedHash: Hex;
};

/**
 * Proof assembly and verification.
 *
 * The one rule this class exists to enforce: a state root is never taken from a
 * caller. It is read from the chain at the block the caller names, and every
 * proof is opened against that root before anything is returned.
 */
export class ProofService {
  readonly #config: Config;
  readonly #substrate: SubstrateClient;
  readonly #evm: EvmClient;
  readonly #startedAt = Date.now();

  constructor(options: ProofServiceOptions) {
    this.#config = options.config;
    this.#substrate = options.substrate;
    this.#evm = options.evm;
  }

  health(): HealthData {
    return {
      status: "ok",
      version: "0.1.0",
      uptimeSeconds: Math.round((Date.now() - this.#startedAt) / 1000),
      now: new Date().toISOString(),
      pid: process.pid,
    };
  }

  /**
   * Resolves a caller's block selector to a real header. `finalized` is the
   * default everywhere: a proof against a block that can still be reorged
   * authorises state that may never have been final.
   */
  async resolveBlock(at: AtInput | undefined): Promise<ResolvedBlock> {
    const finalizedHash = await this.#substrate.finalizedHash();
    const finalized = await this.#substrate.header(finalizedHash);
    const selector = at ?? "finalized";

    let hash: Hex;

    if (selector === "finalized") {
      hash = finalizedHash;
    } else if (selector === "best") {
      hash = await this.#substrate.bestHash();
    } else if (typeof selector === "number") {
      const resolved = await this.#substrate.blockHash(selector);

      if (resolved === null) {
        throw AppError.notFound(`no canonical block at number ${selector}`);
      }

      hash = resolved;
    } else {
      hash = asHex(selector);
    }

    const header =
      hash.toLowerCase() === finalizedHash.toLowerCase()
        ? finalized
        : await this.#substrate.header(hash);

    return {
      hash: header.hash,
      number: header.number,
      parentHash: header.parentHash,
      stateRoot: header.stateRoot,
      finalized: header.number <= finalized.number,
      ageBlocks: Math.max(0, finalized.number - header.number),
    };
  }

  /** Refuses a block that is not final, or is older than the configured window. */
  #assertUsable(block: ResolvedBlock): ResolvedBlock {
    if (!block.finalized) {
      throw AppError.stale(
        `block ${block.hash} is not finalized; proofs are served only against finalized state`,
        { block: block.hash, number: block.number },
      );
    }

    if (block.ageBlocks > this.#config.proofs.maxAgeBlocks) {
      throw AppError.stale(
        `block ${block.number} is ${block.ageBlocks} blocks behind the finalized head (limit ${this.#config.proofs.maxAgeBlocks})`,
        { ageBlocks: block.ageBlocks, maxAgeBlocks: this.#config.proofs.maxAgeBlocks },
      );
    }

    return block;
  }

  async nativeWitness(input: {
    readonly key: Hex;
    readonly at?: AtInput | undefined;
  }): Promise<NativeWitnessData> {
    const block = this.#assertUsable(await this.resolveBlock(input.at));
    const proof = await this.#substrate.readProof([input.key], block.hash);

    if (proof.at.toLowerCase() !== block.hash.toLowerCase()) {
      throw AppError.upstream("the node returned a proof at a different block than requested", {
        requested: block.hash,
        returned: proof.at,
      });
    }

    const storageValue = await this.#substrate.storageOne(input.key, block.hash);
    const verification = verifyStorageProof({
      proof: proof.nodes,
      rootHash: block.stateRoot,
      key: input.key,
    });

    this.#assertVerified(verification, block, proof.nodes.length);

    const agreesWithStorage = compareWithStorage(verification, storageValue);
    const decoded = verification.value === null ? null : decodeStorageValue(input.key, verification.value);

    return {
      key: input.key,
      block,
      nodes: [...proof.nodes],
      nodeCount: proof.nodes.length,
      verification: toWire(verification),
      storageValue,
      agreesWithStorage,
      decoded: decoded === null ? null : toDecodedWire(decoded),
      blockNumberAgrees:
        decoded === null || decoded.encoding !== "u32-le" ? null : decoded.value === block.number,
    };
  }

  async verifyNative(input: {
    readonly key: Hex;
    readonly at?: AtInput | undefined;
    readonly proof?: readonly Hex[] | undefined;
    readonly value?: Hex | null | undefined;
  }): Promise<VerifyNativeData> {
    const block = this.#assertUsable(await this.resolveBlock(input.at));

    let nodes: readonly Hex[];
    let proofSource: "supplied" | "fetched";

    if (input.proof !== undefined) {
      nodes = input.proof;
      proofSource = "supplied";
    } else {
      const fetched = await this.#substrate.readProof([input.key], block.hash);
      nodes = fetched.nodes;
      proofSource = "fetched";
    }

    const checked = verifyStorageProof(
      input.value === undefined
        ? { proof: nodes, rootHash: block.stateRoot, key: input.key }
        : { proof: nodes, rootHash: block.stateRoot, key: input.key, expectedValue: input.value },
    );

    // A proof taken at another block cannot open against this block's root. That
    // is correct, and it is also the single most common way to use this endpoint
    // wrong, so the refusal says which block it was checked against.
    const verification: ProofResult =
      checked.error?.kind === "ROOT_MISSING" && proofSource === "supplied"
        ? {
            ...checked,
            error: {
              kind: checked.error.kind,
              message: `${checked.error.message}. This proof was checked against block ${block.number} (${block.hash}); if it belongs to another block, pass that block as "at".`,
            },
          }
        : checked;

    const decoded =
      verification.value === null ? null : decodeStorageValue(input.key, verification.value);

    return {
      key: input.key,
      block,
      verified: verification.status === "present",
      present: verification.status === "present" || verification.status === "mismatch",
      rootSource: "chain",
      proofSource,
      value: verification.value,
      decoded: decoded === null ? null : toDecodedWire(decoded),
      verification: toWire(verification),
    };
  }

  /**
   * The EVM face. `eth_getProof` is absent on the public Portaldot V3 EVM
   * endpoint; when the node refuses, that refusal is the answer. Nothing is
   * synthesised to fill the gap.
   */
  async evmWitness(input: {
    readonly address: Hex;
    readonly at?: "finalized" | "latest" | undefined;
  }): Promise<EvmWitnessData> {
    const [chainId, blockNumber] = await Promise.all([
      this.#evm.chainId(),
      this.#evm.blockNumber(),
    ]);
    const tag = input.at ?? "finalized";

    try {
      const proof = await this.#evm.accountProof(input.address, [], tag);

      return {
        address: input.address,
        supported: true,
        reason: null,
        evm: { url: this.#evm.url, chainId, blockNumber },
        witness: {
          blockNumber,
          accountProofNodes: proof.accountProof.length,
          storageHash: proof.storageHash,
          verified: false,
          note: "returned as received: this service has no EVM trie verifier, so the account proof is not checked",
        },
        note: "the node implements eth_getProof; the returned account proof is unverified by this service",
      };
    } catch (error) {
      if (!isMethodNotFound(error)) {
        throw AppError.upstream(`eth_getProof failed: ${messageOf(error)}`, {
          upstream: messageOf(error),
        });
      }

      const rpc = error instanceof RpcError ? error : null;

      return {
        address: input.address,
        supported: false,
        reason: {
          code: rpc?.code ?? -32601,
          message: rpc?.message ?? messageOf(error),
          method: "eth_getProof",
        },
        evm: { url: this.#evm.url, chainId, blockNumber },
        witness: null,
        note: "the node does not implement eth_getProof, so no EVM account witness exists on this endpoint",
      };
    }
  }

  async network(): Promise<NetworkData> {
    const latencyMs: Record<string, number> = {};

    const [chain, chainType, version, genesisHash] = await Promise.all([
      this.#timed(latencyMs, "system_chain", () => this.#substrate.systemChain()),
      this.#timed(latencyMs, "system_chainType", () => this.#substrate.systemChainType()),
      this.#timed(latencyMs, "system_version", () => this.#substrate.systemVersion()),
      this.#timed(latencyMs, "chain_getBlockHash#genesis", () => this.#substrate.genesisHash()),
    ]).catch((error: unknown) => {
      throw AppError.upstream(`substrate endpoint unreachable: ${messageOf(error)}`, {
        upstream: messageOf(error),
      });
    });

    const bestHash = await this.#timed(latencyMs, "chain_getBlockHash#best", () =>
      this.#substrate.bestHash(),
    );
    const best = await this.#timed(latencyMs, "chain_getHeader#best", () =>
      this.#substrate.header(bestHash),
    );
    const finalizedHash = await this.#timed(latencyMs, "chain_getFinalizedHead", () =>
      this.#substrate.finalizedHash(),
    );
    const finalized = await this.#timed(latencyMs, "chain_getHeader#finalized", () =>
      this.#substrate.header(finalizedHash),
    );

    let evmChainId = 0;
    let evmHead: { number: number; hash: Hex } | null = null;
    let readProofSupported = false;
    let evmNote: string | null = null;

    try {
      evmChainId = await this.#timed(latencyMs, "eth_chainId", () => this.#evm.chainId());
      const headNumber = await this.#timed(latencyMs, "eth_blockNumber", () =>
        this.#evm.blockNumber(),
      );
      const head = await this.#timed(latencyMs, "eth_getBlockByNumber", () =>
        this.#evm.block("latest"),
      );
      evmHead = { number: headNumber, hash: head.hash };

      try {
        await this.#timed(latencyMs, "eth_getProof", () =>
          this.#evm.accountProof("0x0000000000000000000000000000000000000000", [], "finalized"),
        );
        readProofSupported = true;
      } catch (error) {
        if (!isMethodNotFound(error)) {
          throw error;
        }

        evmNote = `eth_getProof: ${messageOf(error)}`;
      }
    } catch (error) {
      evmNote = `evm endpoint unavailable: ${messageOf(error)}`;
    }

    return {
      substrate: {
        url: this.#substrate.url,
        chain,
        chainType,
        version,
        genesisHash,
        configuredGenesisHash: this.#config.substrate.genesisHash,
        genesisMatches:
          genesisHash.toLowerCase() === this.#config.substrate.genesisHash.toLowerCase(),
      },
      heads: {
        best: { hash: best.hash, number: best.number },
        finalized: {
          hash: finalized.hash,
          number: finalized.number,
          stateRoot: finalized.stateRoot,
        },
        finalityLagBlocks: Math.max(0, best.number - finalized.number),
      },
      evm: {
        url: this.#evm.url,
        chainId: evmChainId,
        configuredChainId: this.#config.evm.chainId,
        chainIdMatches: evmChainId === this.#config.evm.chainId,
        head: evmHead,
        readProofSupported,
        note: evmNote,
      },
      latencyMs,
    };
  }

  async #timed<T>(bucket: Record<string, number>, label: string, run: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();

    try {
      return await run();
    } finally {
      bucket[label] = Math.round(performance.now() - startedAt);
    }
  }

  reads(): ReadsData {
    return {
      reads: [
        {
          method: "chain_getBlockHash",
          transport: "substrate",
          purpose: "genesis hash, best hash and block number to hash resolution",
          usedBy: ["GET /v1/network", "GET /v1/witness/native", "POST /v1/verify/native"],
        },
        {
          method: "chain_getFinalizedHead",
          transport: "substrate",
          purpose: "the finalized head every proof is anchored to",
          usedBy: ["GET /v1/network", "GET /v1/witness/native", "POST /v1/verify/native"],
        },
        {
          method: "chain_getHeader",
          transport: "substrate",
          purpose: "block number, parent hash and state root of the block being proved",
          usedBy: ["GET /v1/network", "GET /v1/witness/native", "POST /v1/verify/native"],
        },
        {
          method: "state_getReadProof",
          transport: "substrate",
          purpose: "raw trie nodes for the requested key at an explicit block hash",
          usedBy: ["GET /v1/witness/native", "POST /v1/verify/native"],
        },
        {
          method: "state_getStorage",
          transport: "substrate",
          purpose: "independent read compared against the proven value",
          usedBy: ["GET /v1/witness/native"],
        },
        {
          method: "system_chain",
          transport: "substrate",
          purpose: "chain identity shown and checked at startup",
          usedBy: ["GET /v1/network", "startup validation"],
        },
        {
          method: "system_chainType",
          transport: "substrate",
          purpose: "live versus development network",
          usedBy: ["GET /v1/network", "startup validation"],
        },
        {
          method: "system_version",
          transport: "substrate",
          purpose: "node version in the network snapshot",
          usedBy: ["GET /v1/network"],
        },
        {
          method: "eth_chainId",
          transport: "evm",
          purpose: "EVM chain id, validated against configuration at startup",
          usedBy: ["GET /v1/network", "GET /v1/witness/evm", "startup validation"],
        },
        {
          method: "eth_blockNumber",
          transport: "evm",
          purpose: "EVM head height",
          usedBy: ["GET /v1/network", "GET /v1/witness/evm"],
        },
        {
          method: "eth_getBlockByNumber",
          transport: "evm",
          purpose: "EVM head hash",
          usedBy: ["GET /v1/network"],
        },
        {
          method: "eth_getProof",
          transport: "evm",
          purpose: "EVM account witness; not implemented by the public V3 testnet endpoint",
          usedBy: ["GET /v1/network", "GET /v1/witness/evm"],
        },
      ],
      notes: [
        "Every substrate read passes an explicit block hash; nothing is read at 'latest'.",
        "state_getReadProof is probed at startup: a node without it cannot serve witnesses.",
        "eth_getProof is reported as unsupported when the node answers 'Method not found'.",
      ],
    };
  }

  /** Startup gate: the live chain must be the chain the configuration names. */
  async startupCheck(): Promise<StartupIdentity> {
    const [chain, chainType, genesisHash, evmChainId, finalizedHash] = await Promise.all([
      this.#substrate.systemChain(),
      this.#substrate.systemChainType(),
      this.#substrate.genesisHash(),
      this.#evm.chainId(),
      this.#substrate.finalizedHash(),
    ]);

    const expectedGenesis = this.#config.substrate.genesisHash.toLowerCase();

    if (genesisHash.toLowerCase() !== expectedGenesis) {
      throw new AppError(
        "CHAIN_MISMATCH",
        500,
        `genesis mismatch: the node reports ${genesisHash}, configuration expects ${this.#config.substrate.genesisHash}`,
        { live: genesisHash, configured: this.#config.substrate.genesisHash },
      );
    }

    if (evmChainId !== this.#config.evm.chainId) {
      throw new AppError(
        "CHAIN_MISMATCH",
        500,
        `EVM chain id mismatch: the endpoint reports ${evmChainId}, configuration expects ${this.#config.evm.chainId}`,
        { live: evmChainId, configured: this.#config.evm.chainId },
      );
    }

    // A node that cannot produce proofs must fail here, not on the first request.
    const methods = await this.#substrate.rpcMethods();


    if (!methods.includes("state_getReadProof")) {
      throw new AppError(
        "CHAIN_MISMATCH",
        500,
        "the substrate endpoint does not expose state_getReadProof, so it cannot serve witnesses",
      );
    }

    return { chain, chainType, genesisHash, evmChainId, finalizedHash };
  }

  #assertVerified(verification: ProofResult, block: ResolvedBlock, supplied: number): void {
    if (verification.status === "invalid" || verification.status === "incomplete") {
      throw AppError.unverified(
        `the node's own proof did not verify: ${verification.error?.kind ?? "unknown"} ${verification.error?.message ?? ""}`.trim(),
        {
          block: block.hash,
          stateRoot: block.stateRoot,
          nodes: supplied,
          error: verification.error,
        },
      );
    }
  }
}

function compareWithStorage(verification: ProofResult, storageValue: string | null): boolean {
  if (verification.status === "absent") {
    return storageValue === null;
  }

  if (verification.value === null || storageValue === null) {
    return false;
  }

  return verification.value.toLowerCase() === storageValue.toLowerCase();
}

function toWire(result: ProofResult): VerifyNativeData["verification"] {
  return {
    status: result.status,
    rootMatches: result.rootMatches,
    root: result.root,
    key: result.key,
    value: result.value,
    expectedValue: result.expectedValue,
    steps: result.steps.map((step) => ({
      depth: step.depth,
      node: step.node,
      kind: step.kind,
      partial: step.partial,
      position: step.position,
      bitmap: step.bitmap,
      childNibble: step.childNibble,
      valueLength: step.valueLength,
      valueHashed: step.valueHashed,
    })),
    nodesSupplied: result.nodesSupplied,
    nodesUsed: result.nodesUsed,
    error: result.error,
  };
}

function toDecodedWire(decoded: DecodedValue): NonNullable<NativeWitnessData["decoded"]> {
  return {
    label: decoded.label,
    encoding: decoded.encoding,
    value: decoded.value,
    note: decoded.note,
  };
}
