// The analysis lane's work-list read.
//
// Follows `pollable-connections.ts` as the named precedent: a small, read-only,
// deliberately separate export on the "./system" subpath, never re-exported from
// src/index.ts, so an import from the web app stays a single greppable line and the
// reachability test's guarantees extend to this module unchanged.
//
// A plain read, not a claim, and that is a decision: the poll's
// `claimDuePollableConnections` moves a cursor because two overlapping ticks must
// partition connections between them. Here the single-writer guarantee already lives
// one layer down, `runAnalysisTick` opens each project's run through the
// conditional-insert claim in `analysis-runs.repo.ts`, and a second tick reading the
// same project list gets `already_running` from that claim, not a duplicate analysis. A
// second cursor here would be a second implementation of a guarantee the lane already
// owns.
import { asc, eq, inArray } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { projectConnections } from "../schema/project-connections";
import { projects } from "../schema/projects";

/**
 * One project the analysis tick should consider, carrying exactly what the producer
 * needs to build a lane and its `TenantContext`, and nothing credential-bearing, same
 * rule as `PollableConnection`.
 */
export interface AnalysableProject {
  readonly organizationId: string;
  /** Joined from `organization.name` so the producer can build a complete
   * `TenantContext` without a second query. */
  readonly organizationName: string;
  readonly projectId: string;
}

/**
 * Every live project with an active session-source connection. The population "a
 * production installation analyses anything" quantifies over.
 *
 * /: this is a new multi-tenant read and it is scoped explicitly. The org id and name
 * come off the joined rows themselves, never from a caller parameter, and the result
 * carries each row's own organisation. There is no cross-org aggregation anywhere: one
 * row in, one `(org, project)` out.
 *
 * An installation with no connected project returns `[]`, which the tick's vocabulary
 * already names as an ordinary answer, not a fault.
 *
 * Distinct by project: a project with two active connections is still one lane. The
 * corpus read is project-scoped, so a second connection changes what the corpus holds,
 * never how many times the project is analysed.
 */
export async function listAnalysableProjects(db: ScopedDb): Promise<AnalysableProject[]> {
  const rows = await db
    .selectDistinct({
      organizationId: projects.organizationId,
      projectId: projects.id,
    })
    .from(projects)
    .innerJoin(projectConnections, eq(projectConnections.projectId, projects.id))
    .where(eq(projectConnections.isActive, true))
    .orderBy(asc(projects.id));

  if (rows.length === 0) {
    return [];
  }

  // The organisation name, resolved for the selected rows only, the same two-step shape
  // `claimDuePollableConnections` uses, for the same driver reason.
  const orgIds = [...new Set(rows.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  return rows.map((row) => {
    // `organization_id` is a cascading FK, so a project whose organisation is missing
    // cannot exist; throwing keeps that an assertion rather than a silent nameless
    // context downstream.
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(`listAnalysableProjects: no organization row for project ${row.projectId}`);
    }

    return {
      organizationId: row.organizationId,
      organizationName,
      projectId: row.projectId,
    };
  });
}

/**
 * ONE project, resolved by its id, with the organization scope READ OFF THE
 * ROW (O-008 AD-10).
 *
 * This is the tenancy half of the onboarding trigger. The queued payload
 * carries a project id and NOTHING ELSE — no organization id and no user id —
 * precisely so the worker cannot be handed a scope: it re-derives one from the
 * project's own row, exactly as `createAnalysisLaneSource` already does for the
 * scheduled path. A payload-supplied organization id would be a door for
 * analysing one customer's project under another customer's context (D7).
 *
 * `null` for a project id that does not exist. There is deliberately no
 * "active connection" predicate here, unlike `listAnalysableProjects`: the
 * onboarding trigger fires immediately after a poll that persisted events for
 * this very project, so requiring the join a second time would re-ask a
 * question the caller already answered — and answering `null` for a project
 * whose connection was revoked in the intervening seconds would silently drop
 * the founder's one analysis rather than letting the lane report its own
 * outcome.
 */
export async function findAnalysableProject(
  db: ScopedDb,
  projectId: string,
): Promise<AnalysableProject | null> {
  const [row] = await db
    .select({
      organizationId: projects.organizationId,
      organizationName: organization.name,
      projectId: projects.id,
    })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.organizationId))
    .where(eq(projects.id, projectId))
    .limit(1);

  return row ?? null;
}
