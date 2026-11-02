// Durable state: title bindings and the single-use proof digests. Both are plain
// tables with a primary key, so a repeat is refused by the database rather than by
// a read-then-write race in application code.

import { DatabaseSync } from "node:sqlite";
import type { TitleBinding } from "./titles/model.ts";

export type ConsumeOutcome =
  | { readonly status: "consumed"; readonly consumedAt: string }
  | { readonly status: "replayed"; readonly consumedAt: string; readonly operation: string };

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
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS consumed_proofs (
        digest      TEXT PRIMARY KEY,
        title_id    TEXT NOT NULL,
        operation   TEXT NOT NULL,
        consumed_at TEXT NOT NULL
      );
    `);
  }

  saveTitle(binding: TitleBinding): void {
    this.db
      .prepare(
        `INSERT INTO titles (title_id, genesis, label, fields, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(title_id) DO UPDATE SET
           genesis = excluded.genesis,
           label = excluded.label,
           fields = excluded.fields`,
      )
      .run(binding.titleId, binding.genesisHash, binding.label, JSON.stringify(binding.fields), new Date().toISOString());
  }

  getTitle(titleId: string): TitleBinding | null {
    const row = this.db
      .prepare(`SELECT title_id, genesis, label, fields FROM titles WHERE title_id = ?`)
      .get(titleId.toLowerCase()) as { title_id: string; genesis: string; label: string; fields: string } | undefined;

    if (row === undefined) return null;
    return {
      titleId: row.title_id,
      genesisHash: row.genesis,
      label: row.label,
      fields: JSON.parse(row.fields) as TitleBinding["fields"],
    };
  }

  listTitles(): TitleBinding[] {
    const rows = this.db
      .prepare(`SELECT title_id, genesis, label, fields FROM titles ORDER BY created_at DESC`)
      .all() as { title_id: string; genesis: string; label: string; fields: string }[];

    return rows.map((row) => ({
      titleId: row.title_id,
      genesisHash: row.genesis,
      label: row.label,
      fields: JSON.parse(row.fields) as TitleBinding["fields"],
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

  close(): void {
    this.db.close();
  }
}
