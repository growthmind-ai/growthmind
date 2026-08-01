import { randomUUID } from "node:crypto";

import type { TenantContext } from "@growthmind/shared";
import { and, asc, eq } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { projects } from "../schema/projects";

/**
 * Idempotent project provisioning for the first-run surface (O-008 AD-7,
 * FR-O1). It copies `ensureOrganization`'s shape line for line
 * (`./ensure-organization.ts:43-148`):
 *
 *   1. If the organization already holds a project, return it.
 *   2. Otherwise insert one carrying the deterministic `provisioning_key`.
 *   3. A concurrent duplicate hits `projects_provisioning_key_uidx` — caught,
 *      then re-read the winner (D6, settled by the CONSTRAINT and never by the
 *      earlier read).
 *
 * WHY THE CONSTRAINT HAD TO BE ADDED FOR THIS TO BE TRUE. `projects` carried
 * only a NON-unique btree index on `organization_id`, so an `INSERT … WHERE NOT
 * EXISTS` genuinely races under READ COMMITTED: both callers see no row, both
 * insert, and the organization silently acquires two projects. AD-7 answers
 * that with a NULLABLE `provisioning_key` under a unique index rather than
 * `UNIQUE (organization_id)` — the latter would have decided, silently and
 * permanently inside an onboarding sprint, that an organization may hold
 * exactly one project. `OQ-O4` is that question and it stays open: this
 * constraint binds the AUTO-PROVISIONING PATH and nothing else, because
 * Postgres permits unlimited NULLs in a unique index and every project created
 * by any other path leaves the column NULL.
 *
 * Invoked from ONE place: the `/first-run` page's server preamble, mirroring
 * how `ensureOrganization` is called by `getTenantContext()`'s self-heal.
 *
 * `db` is typed `ScopedDb` so this compiles against the production driver and
 * the PGlite test harness alike, with no cast and no `any`.
 */

interface EnsureProjectResult {
  projectId: string;
}

/**
 * THE PROVISIONING KEY'S ONE HOME. `org:<organizationId>` is a cross-boundary
 * literal (D9), so it is minted here and read from here, never re-spelled at a
 * call site.
 *
 * D12, and it is why this key is safe where a content-derived signature is not:
 * its ONLY input is `organization.id`, a primary key that never churns. No
 * derived id, no path, no normalised serialisation — so there is no ancestry to
 * track and no fork for an ordinary refactor to cause.
 */
function provisioningKeyFor(organizationId: string): string {
  return `org:${organizationId}`;
}

/**
 * The name a first project gets. Deliberately not derived from anything the
 * customer typed: this row exists so the surface has something to address, and
 * naming projects is a product decision `OQ-O4` has not reached yet.
 */
const DEFAULT_PROJECT_NAME = "Your product";

/** True when `error` is a Postgres unique-violation (`23505`) surfaced through
 * drizzle's `DrizzleQueryError.cause` — the same check `ensureOrganization`
 * makes, verified empirically against both the production node-postgres driver
 * and the PGlite test driver, which wrap the underlying pg error identically. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null | undefined)?.cause;
  return cause?.code === "23505";
}

/** The organization's project, oldest first so two calls agree on which one
 * "the" project is. Org-scoped, and there is no id parameter for a caller to
 * name somebody else's row with (D7). */
async function findFirstProjectForOrg(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, ctx.organizationId))
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .limit(1);

  return row;
}

export async function ensureProject(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<EnsureProjectResult> {
  // THE READ-FIRST FAST PATH, and it is deliberately keyed on the ORGANIZATION
  // rather than on the provisioning key: an organization whose project was
  // created by some other path carries a NULL key, and landing on `/first-run`
  // must not mint it a second project. `OQ-O4` is open; provisioning per visit
  // would answer it by accident.
  const existing = await findFirstProjectForOrg(db, ctx);
  if (existing) {
    return { projectId: existing.id };
  }

  const provisioningKey = provisioningKeyFor(ctx.organizationId);

  try {
    const projectId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        organizationId: ctx.organizationId,
        name: DEFAULT_PROJECT_NAME,
        provisioningKey,
      });
    });

    return { projectId };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      console.error("ensureProject: failed to provision project for organization", {
        organizationId: ctx.organizationId,
        error,
      });
      throw error;
    }

    // D6 AND D8. Lost the race to a concurrent `ensureProject` for this same
    // organization — the winner's insert already committed under this
    // deterministic key. The loser never throws; it re-reads and returns the
    // winner's project. It also SAYS SO, out loud, because a silent recovery is
    // a race an operator cannot see becoming frequent.
    console.error(
      "ensureProject: concurrent duplicate provisioning detected for organization — re-reading winner's project",
      { organizationId: ctx.organizationId, provisioningKey },
    );

    const [winner] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, ctx.organizationId),
          eq(projects.provisioningKey, provisioningKey),
        ),
      )
      .limit(1);

    if (winner) {
      return { projectId: winner.id };
    }

    // UNREACHABLE BY CONSTRUCTION, and therefore loud. The key embeds this
    // organization's own id, so a row owning it that this organization cannot
    // see would mean the stamp and the filter disagree — the D2 failure this
    // whole schema is arranged to prevent. Degrading to "provision another one"
    // here would turn that into an invisible duplicate.
    const notFoundError = new Error(
      `ensureProject: unique-key conflict for organization "${ctx.organizationId}" but no project owning the provisioning key was found`,
    );
    console.error("ensureProject: conflict re-read found no project for the provisioning key", {
      organizationId: ctx.organizationId,
      provisioningKey,
      error: notFoundError,
    });
    throw notFoundError;
  }
}
