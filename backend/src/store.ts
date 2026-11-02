// Durable state: title bindings, accepted revisions and the single-use proof digests.
// Every write that must not happen twice is guarded by a primary key, so a repeat is
// refused by the database rather than by a read-then-write race in application code.

import { DatabaseSync } from "node:sqlite";
import type { TitleBinding } from "./titles/model.ts";

export type ConsumeOutcome =
  | { readonly status: "consumed"; readonly consumedAt: string }
  | { readonly status: "replayed"; readonly consumedAt: string; readonly operation: string };

export type RevisionOutcome =
  | { readonly status: "accepted"; readonly revision: string; readonly previous: string | null }
  | { readonly status: "stale"; readonly revision: string; readonly accepted: string };

type TitleRow = {
  title_id: string;
  genesis: string;
  label: string;
  fields: string;
  evm: string | null;
};

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS titles (
        title_id   TEXT PRIMARY KEY,
        genesis    TEXT NOT NULL,
        label      TEXT NOT NULL,
        fields     TEXT NOT NULL,
        evm        TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accepted_revisions (
        title_id     TEXT NOT NULL,
        revision     TEXT NOT NULL,
        digest       TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        accepted_at  TEXT NOT NULL,
        PRIMARY KEY (title_id, revision)
      );

      CREATE TABLE IF NOT EXISTS consumed_proofs (
        digest      TEXT PRIMARY KEY,
        title_id    TEXT NOT NULL,
        operation   TEXT NOT NULL,
        consumed_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("titles", "evm", "TEXT");
  }

  saveTitle(binding: TitleBinding): void {
    this.db
      .prepare(
        `INSERT INTO titles (title_id, genesis, label, fields, evm, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(title_id) DO UPDATE SET
           genesis = excluded.genesis,
           label = excluded.label,
           fields = excluded.fields,
           evm = excluded.evm`,
      )
      .run(
        binding.titleId,
        binding.genesisHash,
        binding.label,
        JSON.stringify(binding.fields),
        binding.evm === null ? null : JSON.stringify(binding.evm),
        new Date().toISOString(),
      );
  }

  getTitle(titleId: string): TitleBinding | null {
    const row = this.db
      .prepare(`SELECT title_id, genesis, label, fields, evm FROM titles WHERE title_id = ?`)
      .get(titleId.toLowerCase()) as TitleRow | undefined;
    return row === undefined ? null : toBinding(row);
  }

  listTitles(): TitleBinding[] {
    const rows = this.db
      .prepare(`SELECT title_id, genesis, label, fields, evm FROM titles ORDER BY created_at DESC`)
      .all() as TitleRow[];
    return rows.map(toBinding);
  }

  acceptedRevision(titleId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT revision FROM accepted_revisions
         WHERE title_id = ? ORDER BY CAST(revision AS INTEGER) DESC LIMIT 1`,
      )
      .get(titleId.toLowerCase()) as { revision: string } | undefined;
    return row?.revision ?? null;
  }

  /** Accepts a revision only when it is at or above everything already accepted for the title. */
  acceptRevision(input: {
    readonly titleId: string;
    readonly revision: string;
    readonly digest: string;
    readonly blockNumber: number;
  }): RevisionOutcome {
    const previous = this.acceptedRevision(input.titleId);
    if (previous !== null && BigInt(input.revision) < BigInt(previous)) {
      return { status: "stale", revision: input.revision, accepted: previous };
    }

    this.db
      .prepare(
        `INSERT INTO accepted_revisions (title_id, revision, digest, block_number, accepted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(title_id, revision) DO UPDATE SET
           digest = excluded.digest,
           block_number = excluded.block_number,
           accepted_at = excluded.accepted_at`,
      )
      .run(input.titleId.toLowerCase(), input.revision, input.digest, input.blockNumber, new Date().toISOString());

    return { status: "accepted", revision: input.revision, previous };
  }

  revisionHistory(
    titleId: string,
    limit: number,
  ): { revision: string; digest: string; blockNumber: number; acceptedAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT revision, digest, block_number, accepted_at FROM accepted_revisions
         WHERE title_id = ? ORDER BY CAST(revision AS INTEGER) DESC LIMIT ?`,
      )
      .all(titleId.toLowerCase(), limit) as {
      revision: string;
      digest: string;
      block_number: number;
      accepted_at: string;
    }[];

    return rows.map((row) => ({
      revision: row.revision,
      digest: row.digest,
      blockNumber: row.block_number,
      acceptedAt: row.accepted_at,
    }));
  }

  consume(digest: string, titleId: string, operation: string): ConsumeOutcome {
    const now = new Date().toISOString();
    const inserted = this.db
      .prepare(
        `INSERT INTO consumed_proofs (digest, title_id, operation, consumed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(digest) DO NOTHING`,
      )
      .run(digest, titleId, operation, now);

    if (inserted.changes === 1) return { status: "consumed", consumedAt: now };

    const existing = this.db
      .prepare(`SELECT consumed_at, operation FROM consumed_proofs WHERE digest = ?`)
      .get(digest) as { consumed_at: string; operation: string } | undefined;

    return {
      status: "replayed",
      consumedAt: existing?.consumed_at ?? "unknown",
      operation: existing?.operation ?? "unknown",
    };
  }

  counts(): { titles: number; acceptedRevisions: number; consumedProofs: number } {
    const one = (sql: string): number => {
      const row = this.db.prepare(sql).get() as { total: number } | undefined;
      return row?.total ?? 0;
    };

    return {
      titles: one(`SELECT COUNT(*) AS total FROM titles`),
      acceptedRevisions: one(`SELECT COUNT(*) AS total FROM accepted_revisions`),
      consumedProofs: one(`SELECT COUNT(*) AS total FROM consumed_proofs`),
    };
  }

  close(): void {
    this.db.close();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((entry) => entry.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function toBinding(row: TitleRow): TitleBinding {
  return {
    titleId: row.title_id,
    genesisHash: row.genesis,
    label: row.label,
    fields: JSON.parse(row.fields) as TitleBinding["fields"],
    evm: row.evm === null ? null : (JSON.parse(row.evm) as TitleBinding["evm"]),
  };
}
