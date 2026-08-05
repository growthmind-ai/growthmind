import {
  growthContext as toGrowthContext,
  growthContextSchema,
  type GrowthContext,
  type RoledSurface,
} from "@growthmind/core";
import {
  BUSINESS_FACT_LIMIT,
  FACTS_PER_KIND_MAX,
  URL_PATH_NORMALISATION_VERSION,
  capFactsPerKind,
  logger,
  readBusinessContext,
  type BusinessContext,
  type BusinessFact,
  type BusinessFactKind,
  type ResearchStatus,
  type SurfaceRole,
  type TenantContext,
} from "@growthmind/shared";
import { eq, inArray, sql } from "drizzle-orm";

import { publishLive } from "../live/publish";
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

export interface BusinessResearchRow {
  readonly siteDomain: string | null;
  readonly businessContext: BusinessContext;
  readonly researchStatus: ResearchStatus;
  readonly researchedAt: Date | null;
  readonly researchFailure: string | null;

  // The stamp a later write checks itself against. The nightly tick, the site read and a
  // person editing all write this one row.
  readonly updatedAt: Date;
}

export interface StateFactInput {
  readonly projectId: string;
  readonly kind: BusinessFactKind;

  // Null adds. Five of the twelve kinds have no reader that could ever propose them, so
  // this is the only way they are ever filled.
  readonly was: string | null;

  // Null removes the fact named by `was`: a rule that is simply untrue of this business is
  // worth less than no rule.
  readonly statement: string | null;
  readonly statedAt: Date;
}

export type StateFactOutcome = "stated" | "not_found" | "full";

export interface DecideAudienceInput {
  readonly projectId: string;

  // The `who_counts` sentence whose proposal is being answered.
  readonly statement: string;
  readonly decision: "confirm" | "reject";
  readonly decidedAt: Date;
}

export type DecideAudienceOutcome = "decided" | "not_found";

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

  // The site the business context is read from, and where the read got to. Read together
  // because a domain with no outcome beside it is a screen that cannot say whether anything
  // happened.
  readBusinessResearch(projectId: string): Promise<BusinessResearchRow | null>;

  // A person naming the site. Drops what the previous domain's pages said and keeps what a
  // person stated: a conversion or a licence is true of the business, not of the URL.
  stateSiteDomain(input: { projectId: string; siteDomain: string | null }): Promise<void>;

  markResearchRunning(projectId: string): Promise<void>;

  // Replaces what the last read of the site said and nothing else. A person's corrections
  // outrank every later read of the pages they corrected.
  recordResearch(input: {
    projectId: string;
    facts: readonly BusinessFact[];
    researchedAt: Date;
  }): Promise<void>;

  recordResearchFailure(input: { projectId: string; failure: string }): Promise<void>;

  // A person adding, correcting or removing a fact. The row is re-read and re-merged here,
  // because the browser's copy predates whatever the last read wrote.
  stateFact(input: StateFactInput): Promise<StateFactOutcome>;
  decideAudience(input: DecideAudienceInput): Promise<DecideAudienceOutcome>;

  // One page, stated by a person. A whole-list write from a page loaded before last night's
  // run would revert everything that run added, so the merge happens here against the row as
  // it is now rather than against whatever the browser last saw.
  statePageRole(input: StatePageRoleInput): Promise<GrowthContextRow>;
}

export const STATE_PAGE_ROLE_ATTEMPTS = 3;

export const STATE_FACT_ATTEMPTS = 3;

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

// Every write in this file is a read-merge-write against one row the nightly tick, the site
// read and a person editing all contend for. `null` from an attempt means the row moved
// underneath it, so the next attempt has to re-read whatever won: a dependency chain, not a
// fan-out, which is why these awaits are sequential and cannot be batched.
// `T` excludes null so a settled answer can never be mistaken for a lost attempt.
async function whileContended<T extends NonNullable<unknown>>(
  attempts: number,
  attempt: () => Promise<T | null>,
): Promise<T | null> {
  for (let n = 0; n < attempts; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const settled = await attempt();

    if (settled !== null) return settled;
  }

  return null;
}

export function createGrowthContextRepo(db: ScopedExecutor, ctx: TenantContext): GrowthContextRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, growthContext);

  // Beside the writes rather than in the callers: a route or a task that forgot to announce
  // would leave every open page silently stale, and there is no timer behind it to cover
  // for that (D11).
  async function announce(): Promise<void> {
    await publishLive(db, { organizationId: ctx.organizationId, topic: "business_context" });
  }

  async function readRow(projectId: string): Promise<GrowthContextRow | null> {
    return s.maybe(
      await db
        .select()
        .from(growthContext)
        .where(s.owned(growthContext, eq(growthContext.projectId, projectId)))
        .limit(1),
    );
  }

  async function readSnapshot(projectId: string): Promise<GrowthContextSnapshot | null> {
    const row = await readRow(projectId);
    if (row === null) return null;

    const context = readBack(row);

    return context === null ? null : { context, updatedAt: row.updatedAt };
  }

  async function readResearch(projectId: string): Promise<BusinessResearchRow | null> {
    const row = await readRow(projectId);
    if (row === null) return null;

    return {
      siteDomain: row.siteDomain,
      // One unreadable fact costs that fact, never the table: the rest of the settings page
      // is what someone mid-setup actually came for.
      businessContext: readBusinessContext(row.businessContext),
      researchStatus: row.researchStatus,
      researchedAt: row.researchedAt,
      researchFailure: row.researchFailure,
      updatedAt: row.updatedAt,
    };
  }

  // Returns the row it wrote rather than a boolean: `claim` already carries it back, and a
  // caller that needs the row would otherwise re-select what it had just produced.
  async function saveRowIfUnchanged(
    input: SaveGrowthContextInput,
    since: Date | null,
  ): Promise<GrowthContextRow | null> {
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
        // `since === null` means the caller read no row at all, so a row existing now is one
        // that appeared underneath it. `false` refuses the update rather than overwriting
        // whatever arrived.
        setWhere: since === null ? sql`false` : eq(growthContext.updatedAt, since),
        fetch: [eq(growthContext.projectId, input.projectId)],
      },
    );

    return claimed.claimed ? claimed.row : null;
  }

  // Only if the row has not moved since it was read. The nightly tick, the site read and a
  // second person editing all write this one row, and a plain UPDATE here would put back
  // whatever the browser last saw (D6).
  async function writeFactsIfUnchanged(
    projectId: string,
    facts: readonly BusinessFact[],
    removed: readonly string[],
    since: Date,
  ): Promise<boolean> {
    const written = await db
      .update(growthContext)
      .set({
        businessContext: {
          facts: capFactsPerKind(facts).slice(0, BUSINESS_FACT_LIMIT),
          removed: removed.slice(0, BUSINESS_FACT_LIMIT),
        },
        updatedAt: new Date(),
      })
      .where(
        s.owned(
          growthContext,
          eq(growthContext.projectId, projectId),
          eq(growthContext.updatedAt, since),
        ),
      )
      .returning();

    if (written.length === 0) return false;

    await announce();
    return true;
  }

  return {
    async findForProject(projectId: string): Promise<GrowthContext | null> {
      const row = await readRow(projectId);

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

    snapshotForProject(projectId: string): Promise<GrowthContextSnapshot | null> {
      return readSnapshot(projectId);
    },

    async saveIfUnchanged(input: SaveGrowthContextInput, since: Date | null): Promise<boolean> {
      return (await saveRowIfUnchanged(input, since)) !== null;
    },

    // The whole list is rewritten to change one entry, so two people answering different
    // kinds at the same moment would each write the other's stale value back and one answer
    // would vanish with nothing said. Every attempt re-reads and re-merges against the row
    // as it is now.
    async stateFact(input: StateFactInput): Promise<StateFactOutcome> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      const outcome = await whileContended<StateFactOutcome>(STATE_FACT_ATTEMPTS, async () => {
        const current = await readResearch(input.projectId);
        if (current === null) return "not_found";

        const target =
          input.was === null
            ? undefined
            : current.businessContext.facts.find(
                (fact) => fact.kind === input.kind && fact.statement === input.was,
              );

        if (input.was !== null && target === undefined) return "not_found";

        const others = current.businessContext.facts.filter((fact) => fact !== target);

        const removed = current.businessContext.removed;

        if (input.statement === null) {
          // The sentence is kept as a tombstone, not as a fact: without it the next read of
          // the page it came from proposes it again and the removal silently undoes itself.
          const tombstoned = input.was === null ? removed : [...new Set([...removed, input.was])];

          const written = await writeFactsIfUnchanged(
            input.projectId,
            others,
            tombstoned,
            current.updatedAt,
          );

          return written ? "stated" : null;
        }

        const ofKind = others.filter((fact) => fact.kind === input.kind).length;
        if (ofKind >= FACTS_PER_KIND_MAX) return "full";

        const stated: BusinessFact = {
          kind: input.kind,
          statement: input.statement,
          audience: null,
          // A correction is the highest-signal row in the table, so it keeps what it replaced
          // rather than overwriting it into silence — and the next read of the site is
          // suppressed against it.
          correctedFrom: target === undefined ? null : (target.correctedFrom ?? target.statement),
          provenance: {
            source: "stated_by_customer",
            at: input.statedAt,
            citation: null,
            seen: null,
          },
        };

        // Typing a deleted sentence back in is a person changing their mind about the
        // removal, so the tombstone goes with it.
        const revived = removed.filter((gone) => gone !== input.statement);

        const written = await writeFactsIfUnchanged(
          input.projectId,
          [...others, stated],
          revived,
          current.updatedAt,
        );

        return written ? "stated" : null;
      });

      // Answering not_found sends the browser back for a re-read, which is the honest end
      // to a row that kept moving underneath this write.
      return outcome ?? "not_found";
    },

    // Same re-read-and-merge loop as stateFact, and for the same reason: the whole fact list
    // is rewritten to change one entry's proposal.
    async decideAudience(input: DecideAudienceInput): Promise<DecideAudienceOutcome> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      const outcome = await whileContended(STATE_FACT_ATTEMPTS, async () => {
        const current = await readResearch(input.projectId);
        if (current === null) return "not_found";

        const context = current.businessContext;

        const target = context.facts.find(
          (fact) =>
            fact.kind === "who_counts" &&
            fact.statement === input.statement &&
            fact.audience !== null,
        );
        if (target === undefined || target.audience === null) return "not_found";

        const decided: BusinessFact = {
          ...target,
          audience: {
            rule: target.audience.rule,
            status: input.decision === "confirm" ? "confirmed" : "rejected",
            decidedAt: input.decidedAt,
          },
        };

        const others = context.facts.filter((fact) => fact !== target);

        const written = await writeFactsIfUnchanged(
          input.projectId,
          [...others, decided],
          context.removed,
          current.updatedAt,
        );

        return written ? "decided" : null;
      });

      // Contended past the retries reads the same as a row that moved: the browser goes back
      // for a re-read rather than being told a decision stuck when it did not.
      return outcome ?? "not_found";
    },

    async statePageRole(input: StatePageRoleInput): Promise<GrowthContextRow> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      const row = await whileContended(STATE_PAGE_ROLE_ATTEMPTS, async () => {
        const snapshot = await readSnapshot(input.projectId);
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

        return saveRowIfUnchanged(
          {
            projectId: input.projectId,
            surfaces,
            confirmedChangeable: [...changeable],
          },
          snapshot?.updatedAt ?? null,
        );
      });

      if (row === null) {
        throw new Error("growth context: this page kept being answered by someone else mid-write");
      }

      return row;
    },

    readBusinessResearch(projectId: string): Promise<BusinessResearchRow | null> {
      return readResearch(projectId);
    },

    async stateSiteDomain(input: { projectId: string; siteDomain: string | null }): Promise<void> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      const current = await readResearch(input.projectId);

      // Only what the old domain's pages said goes. Wiping a conversion someone typed
      // because they fixed a typo in their address would be ours to lose, not theirs.
      const kept = (current?.businessContext.facts ?? []).filter(
        (fact) => fact.provenance.source !== "site",
      );

      // A deletion is a statement about the business too, so it outlives the address the
      // sentence was read from.
      const removed = current?.businessContext.removed ?? [];

      await c.insertOrFetch(
        {
          projectId: input.projectId,
          siteDomain: input.siteDomain,
          businessContext: { facts: kept, removed },
          researchStatus: "never_run",
          researchedAt: null,
          researchFailure: null,
        },
        {
          target: [growthContext.organizationId, growthContext.projectId],
          set: {
            siteDomain: input.siteDomain,
            businessContext: { facts: kept, removed },
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

      await announce();
    },

    async recordResearch(input: {
      projectId: string;
      facts: readonly BusinessFact[];
      researchedAt: Date;
    }): Promise<void> {
      const settled = {
        researchStatus: "done" as const,
        researchedAt: input.researchedAt,
        researchFailure: null,
      };

      const outcome = await whileContended(STATE_FACT_ATTEMPTS, async () => {
        const current = await readResearch(input.projectId);
        if (current === null) return "absent";

        // A whole-column overwrite would erase every correction on every re-read, which is
        // the one row in this table that cost a person their time.
        const kept = current.businessContext.facts.filter(
          (fact) => fact.provenance.source !== "site",
        );

        // A person who corrected or deleted a sentence should not be handed it back by the
        // next read of the page it came from.
        const removed = current.businessContext.removed;
        const alreadyAnswered = new Set([
          ...removed,
          ...kept.flatMap((fact) =>
            fact.correctedFrom === null ? [fact.statement] : [fact.statement, fact.correctedFrom],
          ),
        ]);

        const merged = capFactsPerKind([
          ...kept,
          ...input.facts.filter((fact) => !alreadyAnswered.has(fact.statement)),
        ]).slice(0, BUSINESS_FACT_LIMIT);

        const written = await db
          .update(growthContext)
          .set({ businessContext: { facts: merged, removed }, ...settled, updatedAt: new Date() })
          .where(
            s.owned(
              growthContext,
              eq(growthContext.projectId, input.projectId),
              eq(growthContext.updatedAt, current.updatedAt),
            ),
          )
          .returning();

        if (written.length === 0) return null;

        await announce();
        return "recorded";
      });

      if (outcome !== null) return;

      // Contended past the retries. The status still has to settle or a person watches
      // "running" forever (D8), and what this read found is re-derivable by pressing the
      // button again — whatever they typed in the meantime is not.
      logger.warn(
        "growth context: the site read kept being overtaken, so only its status was recorded",
        {
          projectId: input.projectId,
        },
      );

      await db
        .update(growthContext)
        .set({ ...settled, updatedAt: new Date() })
        .where(s.owned(growthContext, eq(growthContext.projectId, input.projectId)));

      await announce();
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

      await announce();
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
