import {
  growthContext as toGrowthContext,
  growthContextSchema,
  type GrowthContext,
  type RoledSurface,
} from "@growthmind/core";
import {
  EMPTY_ICP,
  URL_PATH_NORMALISATION_VERSION,
  icpModelSchema,
  logger,
  type IcpBeliefKind,
  type IcpModel,
  type ResearchStatus,
  type SurfaceRole,
  type TenantContext,
} from "@growthmind/shared";
import { eq, inArray, sql } from "drizzle-orm";

import { growthContext } from "../schema/growth-context";
import { orgCrud } from "./crud";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

export type GrowthContextRow = typeof growthContext.$inferSelect;

export interface SaveGrowthContextInput {
  readonly projectId: string;
  readonly surfaces: unknown;
  readonly confirmedChangeable: unknown;
}

export interface StatePageRoleInput {
  readonly projectId: string;
  readonly surface: string;
  readonly role: SurfaceRole;
  readonly statedAt: Date;

  // Undefined leaves the §5 override as it is; a boolean sets it. Nothing derived may pass
  // anything but undefined here.
  readonly changeable?: boolean;
}

export interface SiteResearchRow {
  readonly siteDomain: string | null;
  readonly icp: IcpModel;
  readonly researchStatus: ResearchStatus;
  readonly researchedAt: Date | null;
  readonly researchFailure: string | null;
}

export interface CorrectBeliefInput {
  readonly projectId: string;
  readonly kind: IcpBeliefKind;

  // The statement being replaced, as the person saw it.
  readonly was: string;

  // Null removes the belief outright: a claim that is simply untrue of this product is
  // worth less than no claim.
  readonly statement: string | null;
  readonly statedAt: Date;
}

export interface GrowthContextSnapshot {
  readonly context: GrowthContext;

  readonly updatedAt: Date;
}

export interface GrowthContextRepo {
  // Null is "nothing is known about this project's surfaces", which every caller answers
  // by weighing every surface the same. It is never an error.
  findForProject(projectId: string): Promise<GrowthContext | null>;

  // Absent projects are absent keys, never null values: a caller reading a missing key
  // gets undefined and weighs that project's surfaces the same, which is the same answer
  // `findForProject` gives.
  findForProjects(projectIds: readonly string[]): Promise<ReadonlyMap<string, GrowthContext>>;

  // Carries the stamp a later write can check itself against.
  snapshotForProject(projectId: string): Promise<GrowthContextSnapshot | null>;

  save(input: SaveGrowthContextInput): Promise<GrowthContextRow>;

  // The write for anything that derived its answer from a row it read earlier. `false` means
  // the row moved underneath it and nothing was written — a person confirming a role between
  // the read and the write must not have that confirmation derived away.
  saveIfUnchanged(input: SaveGrowthContextInput, since: Date | null): Promise<boolean>;

  // The site the ICP is read from, and where the research got to. Read together because a
  // domain with no outcome beside it is a screen that cannot say whether anything happened.
  readSiteResearch(projectId: string): Promise<SiteResearchRow | null>;

  // A person naming the site. Clears the previous outcome: the beliefs on the row describe
  // the domain that was there before, and leaving them beside a new one is a lie of layout.
  stateSiteDomain(input: { projectId: string; siteDomain: string | null }): Promise<void>;

  markResearchRunning(projectId: string): Promise<void>;

  recordResearch(input: { projectId: string; icp: IcpModel; researchedAt: Date }): Promise<void>;

  recordResearchFailure(input: { projectId: string; failure: string }): Promise<void>;

  // A person disagreeing with a belief. `statement: null` removes it. Either way the row is
  // re-read and re-merged here, because the browser's copy predates whatever the last read
  // wrote. Returns false when the belief being corrected is no longer there.
  correctBelief(input: CorrectBeliefInput): Promise<boolean>;

  // One page, stated by a person. A whole-list write from a page loaded before last night's
  // run would revert everything that run added, so the merge happens here against the row as
  // it is now rather than against whatever the browser last saw.
  statePageRole(input: StatePageRoleInput): Promise<GrowthContextRow>;
}

export const STATE_PAGE_ROLE_ATTEMPTS = 3;

const notOurProject = (): Error =>
  new Error("growth context: the project named is not this organization's");

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBack(row: GrowthContextRow): GrowthContext | null {
  try {
    return toGrowthContext(
      growthContextSchema.parse({
        surfaces: row.surfaces,
        confirmedChangeable: row.confirmedChangeable,
      }),
    );
  } catch (error) {
    logger.error("growth context: a stored row could not be read back", {
      projectId: row.projectId,
      reason: reasonOf(error),
    });
    return null;
  }
}

export function createGrowthContextRepo(db: ScopedExecutor, ctx: TenantContext): GrowthContextRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, growthContext);

  return {
    async findForProject(projectId: string): Promise<GrowthContext | null> {
      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
        .limit(1);

      const row = s.maybe(rows);

      // One unreadable row costs this project its weighting, not its delivery: the caller
      // treats null as "weigh everything the same", which is the ordering that shipped
      // before any of this existed.
      return row === null ? null : readBack(row);
    },

    async findForProjects(
      projectIds: readonly string[],
    ): Promise<ReadonlyMap<string, GrowthContext>> {
      const byProject = new Map<string, GrowthContext>();
      if (projectIds.length === 0) {
        return byProject;
      }

      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, inArray(growthContext.projectId, [...new Set(projectIds)])));

      for (const row of rows) {
        const read = readBack(row);
        if (read !== null) {
          byProject.set(row.projectId, read);
        }
      }

      return byProject;
    },

    async snapshotForProject(projectId: string): Promise<GrowthContextSnapshot | null> {
      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
        .limit(1);

      const row = s.maybe(rows);
      if (row === null) return null;

      const context = readBack(row);

      return context === null ? null : { context, updatedAt: row.updatedAt };
    },

    async saveIfUnchanged(input: SaveGrowthContextInput, since: Date | null): Promise<boolean> {
      const parsed = growthContextSchema.parse({
        surfaces: input.surfaces,
        confirmedChangeable: input.confirmedChangeable,
      });

      await s.assertProjectOwned(input.projectId, notOurProject);

      const claimed = await c.claim(
        {
          projectId: input.projectId,
          surfaces: parsed.surfaces,
          confirmedChangeable: parsed.confirmedChangeable,
        },
        {
          target: [growthContext.organizationId, growthContext.projectId],
          set: {
            surfaces: parsed.surfaces,
            confirmedChangeable: parsed.confirmedChangeable,
            updatedAt: new Date(),
          },
          // `since === null` means the caller read no row at all, so a row existing now is
          // one that appeared underneath it. `false` refuses the update rather than
          // overwriting whatever arrived.
          setWhere: since === null ? sql`false` : eq(growthContext.updatedAt, since),
          fetch: [eq(growthContext.projectId, input.projectId)],
        },
      );

      return claimed.claimed;
    },

    // The whole list is rewritten to change one entry, so two people answering different
    // pages at the same moment would each write the other's stale value back and one answer
    // would vanish with nothing said. Every attempt re-reads and re-merges against the row
    // as it is now, and only writes if it has not moved since.
    async correctBelief(input: CorrectBeliefInput): Promise<boolean> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      const current = await this.readSiteResearch(input.projectId);
      if (current === null) return false;

      const target = current.icp.beliefs.find(
        (belief) => belief.kind === input.kind && belief.statement === input.was,
      );
      if (target === undefined) return false;

      const others = current.icp.beliefs.filter((belief) => belief !== target);

      const beliefs =
        input.statement === null
          ? others
          : [
              ...others,
              {
                kind: input.kind,
                statement: input.statement,
                // A correction is the highest-signal row in the table, so it keeps what it
                // replaced rather than overwriting it into silence.
                correctedFrom: target.correctedFrom ?? target.statement,
                provenance: {
                  source: "stated_by_customer" as const,
                  at: input.statedAt,
                  citation: null,
                },
              },
            ];

      await db
        .update(growthContext)
        .set({ icp: { beliefs }, updatedAt: new Date() })
        .where(s.owned(growthContext, eq(growthContext.projectId, input.projectId)));

      return true;
    },

    async statePageRole(input: StatePageRoleInput): Promise<GrowthContextRow> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      for (let attempt = 0; attempt < STATE_PAGE_ROLE_ATTEMPTS; attempt += 1) {
        const snapshot = await this.snapshotForProject(input.projectId);
        const existing = snapshot?.context ?? null;

        const stated: RoledSurface = {
          surface: input.surface,
          role: input.role,
          basis: "stated_by_customer",
          confirmedAt: input.statedAt,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        };

        const surfaces = [
          ...[...(existing?.bySurface.values() ?? [])].filter(
            (roled) => roled.surface !== input.surface,
          ),
          stated,
        ];

        const changeable = new Set(existing?.confirmedChangeable ?? []);
        if (input.changeable === true) changeable.add(input.surface);
        if (input.changeable === false) changeable.delete(input.surface);

        const written = await this.saveIfUnchanged(
          {
            projectId: input.projectId,
            surfaces,
            confirmedChangeable: [...changeable],
          },
          snapshot?.updatedAt ?? null,
        );

        if (written) {
          const row = s.maybe(
            await db
              .select()
              .from(growthContext)
              .where(s.owned(growthContext, eq(growthContext.projectId, input.projectId)))
              .limit(1),
          );

          if (row !== null) return row;
        }
      }

      throw new Error("growth context: this page kept being answered by someone else mid-write");
    },

    async readSiteResearch(projectId: string): Promise<SiteResearchRow | null> {
      const rows = await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
        .limit(1);

      const row = s.maybe(rows);
      if (row === null) return null;

      const parsed = icpModelSchema.safeParse(row.icp);

      return {
        siteDomain: row.siteDomain,
        // An unreadable model reads as no beliefs rather than throwing: the rest of the
        // settings page is what someone mid-setup actually came for.
        icp: parsed.success ? parsed.data : EMPTY_ICP,
        researchStatus: row.researchStatus,
        researchedAt: row.researchedAt,
        researchFailure: row.researchFailure,
      };
    },

    async stateSiteDomain(input: { projectId: string; siteDomain: string | null }): Promise<void> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      await c.insertOrFetch(
        {
          projectId: input.projectId,
          siteDomain: input.siteDomain,
          icp: EMPTY_ICP,
          researchStatus: "never_run",
          researchedAt: null,
          researchFailure: null,
        },
        {
          target: [growthContext.organizationId, growthContext.projectId],
          set: {
            siteDomain: input.siteDomain,
            icp: EMPTY_ICP,
            researchStatus: "never_run",
            researchedAt: null,
            researchFailure: null,
            updatedAt: new Date(),
          },
          fetch: [eq(growthContext.projectId, input.projectId)],
        },
      );
    },

    async markResearchRunning(projectId: string): Promise<void> {
      await db
        .update(growthContext)
        .set({ researchStatus: "running", researchFailure: null, updatedAt: new Date() })
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)));
    },

    async recordResearch(input: {
      projectId: string;
      icp: IcpModel;
      researchedAt: Date;
    }): Promise<void> {
      await db
        .update(growthContext)
        .set({
          icp: input.icp,
          researchStatus: "done",
          researchedAt: input.researchedAt,
          researchFailure: null,
          updatedAt: new Date(),
        })
        .where(s.owned(growthContext, eq(growthContext.projectId, input.projectId)));
    },

    // Every exit path records where it got to, so nothing sits on "running" forever (D8).
    async recordResearchFailure(input: { projectId: string; failure: string }): Promise<void> {
      await db
        .update(growthContext)
        .set({
          researchStatus: "failed",
          researchFailure: input.failure,
          updatedAt: new Date(),
        })
        .where(s.owned(growthContext, eq(growthContext.projectId, input.projectId)));
    },

    async save(input: SaveGrowthContextInput): Promise<GrowthContextRow> {
      const parsed = growthContextSchema.parse({
        surfaces: input.surfaces,
        confirmedChangeable: input.confirmedChangeable,
      });

      await s.assertProjectOwned(input.projectId, notOurProject);

      return c.insertOrFetch(
        {
          projectId: input.projectId,
          surfaces: parsed.surfaces,
          confirmedChangeable: parsed.confirmedChangeable,
        },
        {
          target: [growthContext.organizationId, growthContext.projectId],
          set: {
            surfaces: parsed.surfaces,
            confirmedChangeable: parsed.confirmedChangeable,
          },
          fetch: [eq(growthContext.projectId, input.projectId)],
        },
      );
    },
  };
}
