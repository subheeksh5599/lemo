import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { bytesToHex, hexToBytes, type Hex } from "../../src/util/bytes.ts";

export type FixtureProof = {
  readonly label: string;
  readonly key: Hex;
  readonly storage: Hex | null;
  readonly proof: readonly Hex[];
  readonly verified: Record<string, unknown>;
};

export type Fixture = {
  readonly capturedAt: string;
  readonly network: {
    readonly substrateRpc: string;
    readonly evmRpc: string;
    readonly chain: string;
    readonly chainType: string;
    readonly genesisHash: Hex;
    readonly evmChainId: number;
  };
  readonly block: {
    readonly hash: Hex;
    readonly number: number;
    readonly parentHash: Hex;
    readonly stateRoot: Hex;
  };
  readonly proofs: {
    readonly systemNumber: FixtureProof;
    readonly systemAccount: FixtureProof;
    readonly absentKey: FixtureProof;
  };
};

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "portaldot-v3.json",
);

/**
 * The one real proof set this suite is built on: `state_getReadProof` from the
 * Portaldot V3 testnet at a finalized block, captured by
 * `scripts/capture-fixtures.ts` and verified against `state_getStorage` there.
 */
export function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
}

export function allProofs(fixture: Fixture): readonly FixtureProof[] {
  return [fixture.proofs.systemNumber, fixture.proofs.systemAccount, fixture.proofs.absentKey];
}

export function proofByKey(fixture: Fixture, key: string): FixtureProof | undefined {
  return allProofs(fixture).find((entry) => entry.key.toLowerCase() === key.toLowerCase());
}

/** Finds the proof node whose blake2_256 equals `hash`. */
export function findNodeForHash(proof: readonly Hex[], hash: string): Hex | undefined {
  return proof.find((node) => bytesToHex(blake2AsU8a(hexToBytes(node), 256)) === hash.toLowerCase());
}

/**
 * Flips a byte inside the node that hashes to `hash`, leaving every other node
 * untouched. Proof nodes arrive in no guaranteed order, so tampering by index
 * would sometimes corrupt a node the path never uses.
 */
export function tamperNodesForHash(
  proof: readonly Hex[],
  hash: string,
  byteIndex = 3,
): Hex[] {
  return proof.map((node) =>
    bytesToHex(blake2AsU8a(hexToBytes(node), 256)) === hash.toLowerCase()
      ? tamperHex(node, byteIndex)
      : node,
  );
}

/** Flips one byte inside a hex string, producing a node that no longer hashes. */
export function tamperHex(hex: Hex, byteIndex = 4): Hex {
  const body = hex.slice(2).split("");
  const at = byteIndex * 2;

  if (at + 1 >= body.length) {
    throw new Error("tamper index is outside the value");
  }

  const current = Number.parseInt(`${body[at]}${body[at + 1]}`, 16);
  const next = (current ^ 0xff).toString(16).padStart(2, "0");
  body[at] = next.slice(0, 1);
  body[at + 1] = next.slice(1);

  return `0x${body.join("")}` as Hex;
}
