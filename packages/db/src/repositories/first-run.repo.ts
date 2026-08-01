// Repository for the first-run surface's two persisted facts (O-008 AD-8,
// AD-17). ONE factory, TWO tables, TWO grains — and the grains are the whole
// design:
//
//   `first_run_state`      — (organization_id, project_id). The CLOCK ORIGIN.
//   `first_run_dismissals` — (organization_id, user_id).    The DISMISSAL.
//
// `armed_at` must be ORG-grained: a teammate who opens the link thirty seconds
// into the wait has to see the SAME wait, counting from the SAME origin, not an
// unarmed surface inviting them to trigger what is already running. Dismissal
// must be USER-grained: `/first-run` is the only surface this product has, so a
// per-org dismissal would let the first member who pressed "hide this" remove
// the entire product from every teammate's account. Folding both into one table
// behind a nullable discriminator is the D2 stamp/filter asymmetry the taxonomy
// names, and it is the shape that produced this repository's "no rows at
// project scope, seventeen at org root" incident.
//
// EVERY WRITE IS AN UPSERT AGAINST THE GRAIN'S OWN PRIMARY KEY, never a
// read-then-write (D6). "Watch again" pressed twice, a dismissal clicked twice,
// two members arming at the same moment — each is ONE fact, settled by the
// constraint, and none of them races itself.
//
// The organization half of every key comes from `ctx` and never from a
// parameter, so a client-supplied project id or user id belonging to another
// organization resolves to "nothing", never to that organization's clock (D7).
import type { TenantContext } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { firstRunDismissals } from "../schema/first-run-dismissals";
import { firstRunState } from "../schema/first-run-state";
import type { ScopedDb } from "./types";

/**
 * The `first_run_state` row as this repository hands it out.
 *
 * TWO NULLABLE STAMPS AND NOTHING ELSE. There is deliberately no
 * connection-shaped field here: FR-O14's degraded notice is derived from the
 * ABSENCE OF AN ACTIVE SLACK CONNECTION, which is what makes it survive a
 * reload and a revocation by construction. A `slackConnected` boolean cached
 * onto this row would be the D11 hand-passed wire the two-mechanism split
 * exists to avoid — written by one path, read by another, and stale the moment
 * anybody else disconnects.
 */
export interface FirstRunState {
  /** The clock origin. `null` is the fact "never armed" — never a zero and
   * never the epoch. The stage reducer's `unarmed` branch turns on exactly this
   * distinction, so a sentinel here would render a founder who has pressed
   * nothing a wait that started in 1970. */
  readonly armedAt: Date | null;
  /** Set when somebody deliberately walks PAST the Slack step, so the step
   * state can tell `skipped` from `pending`. Independent of `armedAt`. */
  readonly slackSkippedAt: Date | null;
}

export interface FirstRunRepo {
  /** `null` when this organization and project have no row yet. NOT an empty
   * state object — "never armed" and "armed then cleared" are different facts. */
  readState(projectId: string): Promise<FirstRunState | null>;
  /** "Watch again" RESETS the clock origin: one row per org+project, REPLACED,
   * never appended to. A second arming that appended would leave the surface
   * counting from the first trigger — a founder pressing the button again would
   * watch a number that is already minutes old. */
  arm(projectId: string, armedAt: Date): Promise<FirstRunState>;
  /** Skipping is NOT arming: this write touches `slack_skipped_at` alone, so it
   * cannot start the clock for somebody who only pressed "skip for now". */
  skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState>;
  /**
   * PER USER (AD-17), and the user id is an explicit parameter rather than
   * `ctx.userId` so the (organization_id, user_id) grain is visible at the call
   * site. That is not redundancy: it is the difference between a per-user fact
   * and a per-actor side effect, and the property ESC-O2 rests on.
   *
   * An UPSERT, not an insert — dismissing twice is one fact, and a plain insert
   * would raise `23505` on the second click.
   */
  dismiss(userId: string, dismissedAt: Date): Promise<void>;
  isDismissed(userId: string): Promise<boolean>;
}

/** Field-by-field, never a spread: the shape this repository promises is the
 * two stamps, and a row growing a column later must not silently widen it. */
function toFirstRunState(row: {
  armedAt: Date | null;
  slackSkippedAt: Date | null;
}): FirstRunState {
  return { armedAt: row.armedAt, slackSkippedAt: row.slackSkippedAt };
}

export function createFirstRunRepo(db: ScopedDb, ctx: TenantContext): FirstRunRepo {
  return {
    async readState(projectId: string): Promise<FirstRunState | null> {
      // BOTH halves of the grain, always. A read filtered on the project id
      // ALONE would compile, pass every single-tenant test, and hand one
      // organization another's clock (D7).
      const [row] = await db
        .select({
          armedAt: firstRunState.armedAt,
          slackSkippedAt: firstRunState.slackSkippedAt,
        })
        .from(firstRunState)
        .where(
          and(
            eq(firstRunState.organizationId, ctx.organizationId),
            eq(firstRunState.projectId, projectId),
          ),
        )
        .limit(1);

      return row ? toFirstRunState(row) : null;
    },

    async arm(projectId: string, armedAt: Date): Promise<FirstRunState> {
      // ONE STATEMENT, and the conflict target IS the grain. The returned row
      // is the one Postgres actually wrote, so nothing here reads back what it
      // just wrote and nothing can observe a state between the two.
      const [row] = await db
        .insert(firstRunState)
        .values({ organizationId: ctx.organizationId, projectId, armedAt })
        .onConflictDoUpdate({
          target: [firstRunState.organizationId, firstRunState.projectId],
          set: { armedAt },
        })
        .returning();

      if (!row) {
        throw new Error("arm: upsert returned no first_run_state row");
      }

      return toFirstRunState(row);
    },

    async skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState> {
      // `armed_at` is absent from BOTH the insert values and the conflict
      // `set`, so an organization that has already armed keeps its origin and
      // one that has not stays unarmed.
      const [row] = await db
        .insert(firstRunState)
        .values({ organizationId: ctx.organizationId, projectId, slackSkippedAt: skippedAt })
        .onConflictDoUpdate({
          target: [firstRunState.organizationId, firstRunState.projectId],
          set: { slackSkippedAt: skippedAt },
        })
        .returning();

      if (!row) {
        throw new Error("skipSlack: upsert returned no first_run_state row");
      }

      return toFirstRunState(row);
    },

    async dismiss(userId: string, dismissedAt: Date): Promise<void> {
      await db
        .insert(firstRunDismissals)
        .values({ organizationId: ctx.organizationId, userId, dismissedAt })
        .onConflictDoUpdate({
          target: [firstRunDismissals.organizationId, firstRunDismissals.userId],
          set: { dismissedAt },
        });
    },

    async isDismissed(userId: string): Promise<boolean> {
      // The PARAMETER's user id, under THIS context's organization. A lookup
      // narrowed by the user alone would answer for a member of some other
      // organization; one that read `ctx.userId` and ignored the parameter
      // would answer about the wrong person entirely.
      const [row] = await db
        .select({ userId: firstRunDismissals.userId })
        .from(firstRunDismissals)
        .where(
          and(
            eq(firstRunDismissals.organizationId, ctx.organizationId),
            eq(firstRunDismissals.userId, userId),
          ),
        )
        .limit(1);

      return row !== undefined;
    },
  };
}
