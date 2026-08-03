import { sql } from "drizzle-orm";

import journal from "../drizzle/meta/_journal.json";

import type { ScopedDb } from "./repositories/types";

export interface SchemaStatus {
  expected: number;
  applied: number;
  pending: number;
}

export function compareMigrationCounts(expected: number, applied: number): SchemaStatus {
  return { expected, applied, pending: Math.max(0, expected - applied) };
}

export function describeSchemaStatus(status: SchemaStatus): string | null {
  if (status.pending === 0) return null;
  return (
    `The database schema is ${status.pending} migration${status.pending === 1 ? "" : "s"} ` +
    `behind the code (${status.applied} of ${status.expected} applied). Run: bun run db:migrate`
  );
}

type RawExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
};

// 42P01 (undefined_table) means drizzle-kit has never run here: everything is pending.
export async function getSchemaStatus(db: ScopedDb): Promise<SchemaStatus> {
  const expected = journal.entries.length;

  try {
    const result = await (db as unknown as RawExecutor).execute(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    );
    const first = result.rows[0] as { applied?: number | string } | undefined;
    const applied = Number(first?.applied ?? 0);
    return compareMigrationCounts(expected, Number.isFinite(applied) ? applied : 0);
  } catch (error) {
    if (isUndefinedTable(error)) {
      return compareMigrationCounts(expected, 0);
    }
    throw error;
  }
}

function isUndefinedTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const causeCode = ((error as { cause?: { code?: unknown } }).cause ?? {}).code;
  return code === "42P01" || causeCode === "42P01";
}
