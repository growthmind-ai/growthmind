import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { createDivergencePointsRepo } from "../../src/repositories/divergence-points.repo";
import { createTestDb, seedOrgWithOwner, seedProject, type TestDb } from "../../src/testing";

// TODO(o-045): replace with SURFACE_COHORT_CUT from @growthmind/shared once
// packages/shared/src/cohort-cuts/cuts.ts lands (ADD Decision 1).
const SURFACE_COHORT_CUT = "surface";

const MIGRATIONS_DIR = path.join(import.meta.dir, "..", "..", "drizzle");

const SURFACE = "/checkout";
const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const SURFACE_NORMALISATION_VERSION = 2;
const SPINE_VERSION = 1;
const COHORT_MATCH_VERSION = 1;

const PRE_MIGRATION_RANK = 3;
const PRE_MIGRATION_SUCCEEDED = 12;
const PRE_MIGRATION_FAILED = 8;

const NEXT_TICK_RANK = 2;

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return rows ?? [];
}

// The shape a divergence_points row already on `main` has the moment ALTER TABLE lands:
// every column the pre-0026 writer supplied, and no cohort_cut.
async function insertPreMigrationRow(
  db: TestDb,
  params: { organizationId: string; projectId: string },
): Promise<string> {
  const id = randomUUID();

  await db.execute(sql`
    insert into divergence_points (
      id, organization_id, project_id,
      surface, surface_normalisation_version, spine_version, cohort_match_version,
      window_start, window_end,
      kind, diverged_at_rank, reason,
      succeeded_cohort_size, failed_cohort_size,
      succeeded_session_ids_sample, failed_session_ids_sample
    ) values (
      ${id}, ${params.organizationId}, ${params.projectId},
      ${SURFACE}, ${SURFACE_NORMALISATION_VERSION}, ${SPINE_VERSION}, ${COHORT_MATCH_VERSION},
      ${WINDOW_START.toISOString()}::timestamptz, ${WINDOW_END.toISOString()}::timestamptz,
      'diverged', ${PRE_MIGRATION_RANK}, null,
      ${PRE_MIGRATION_SUCCEEDED}, ${PRE_MIGRATION_FAILED},
      ${JSON.stringify(["session-1"])}::jsonb, ${JSON.stringify(["session-2"])}::jsonb
    )
  `);

  return id;
}

async function cohortCutRows(db: TestDb, projectId: string): Promise<readonly string[]> {
  const result = await db.execute(
    sql`select id, cohort_cut from divergence_points where project_id = ${projectId}`,
  );

  return rowsOf(result).map((row) => `${String(row.id)}:${String(row.cohort_cut)}`);
}

describe("migration 0026 — rows already on main (ADD Decision 7, D13)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("backfills a pre-existing row to the surface cut rather than leaving it null", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-backfill",
      userName: "Owner Divergence Backfill",
      email: "owner-divergence-backfill@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-backfill",
    });

    const id = await insertPreMigrationRow(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });

    const [row] = rowsOf(
      await db.execute(sql`select cohort_cut from divergence_points where id = ${id}`),
    );

    expect(row?.cohort_cut).toBe(SURFACE_COHORT_CUT);
    expect(row?.cohort_cut).not.toBeNull();
  });

  it("keeps a pre-migration row reachable by the next tick's upsert, updated not inserted", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-reachable",
      userName: "Owner Divergence Reachable",
      email: "owner-divergence-reachable@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-reachable",
    });

    const id = await insertPreMigrationRow(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });

    await createDivergencePointsRepo(db, org.ctx).recordDivergence({
      projectId: project.id,
      surface: SURFACE,
      cohortCut: SURFACE_COHORT_CUT,
      surfaceNormalisationVersion: SURFACE_NORMALISATION_VERSION,
      spineVersion: SPINE_VERSION,
      cohortMatchVersion: COHORT_MATCH_VERSION,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      kind: "diverged",
      divergedAtRank: NEXT_TICK_RANK,
      reason: null,
      succeededCohortSize: PRE_MIGRATION_SUCCEEDED,
      failedCohortSize: PRE_MIGRATION_FAILED,
      succeededSessionIdsSample: ["session-1"],
      failedSessionIdsSample: ["session-2"],
    });

    expect(await cohortCutRows(db, project.id)).toEqual([`${id}:${SURFACE_COHORT_CUT}`]);

    const [row] = rowsOf(
      await db.execute(sql`select diverged_at_rank from divergence_points where id = ${id}`),
    );
    expect(Number(row?.diverged_at_rank)).toBe(NEXT_TICK_RANK);
  });

  it("adds the column NOT NULL with the surface default and rebuilds the identity index", () => {
    const generated = readdirSync(MIGRATIONS_DIR).filter((name) => /^0026_.*\.sql$/.test(name));
    expect(generated).toHaveLength(1);

    const text = readFileSync(path.join(MIGRATIONS_DIR, generated[0] ?? ""), "utf8")
      .toLowerCase()
      .replace(/\s+/g, " ");

    expect(text).toContain("cohort_cut");
    expect(text).toContain("not null");
    expect(text).toContain("default 'surface'");

    const rebuilt = text
      .split(";")
      .find(
        (statement) =>
          statement.includes("create unique index") &&
          statement.includes("divergence_points_identity_key"),
      );

    expect(rebuilt).toBeDefined();
    expect(rebuilt).toContain("cohort_cut");
  });
});
