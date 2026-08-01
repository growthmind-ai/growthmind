import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

/**
 * The first-run surface's two persisted facts, at the (organization, project)
 * grain (O-008 AD-8).
 *
 * ── WHY THIS IS ORG-GRAINED AND NOT A SESSION FLAG ──────────────────────────
 * `armed_at` is the CLOCK ORIGIN the waiting surface counts up from. A clock
 * whose origin is not durable is a clock that resets on reload, and a clock
 * that is durable per USER is a clock a teammate arriving mid-wait does not
 * share: they would land on an unarmed surface inviting them to trigger the
 * thing that is already running. One row per organization and project means
 * every member watches the same wait, from the same origin.
 *
 * ── AND WHY DISMISSAL IS NOT IN THIS TABLE (D2) ─────────────────────────────
 * Dismissal is per USER (`./first-run-dismissals.ts`). Folding it in here
 * behind a nullable `user_id` discriminator is the stamp/filter asymmetry the
 * taxonomy names, and it is exactly the shape that produced this repository's
 * "no rows at project scope, seventeen at org root" incident: a read narrowed
 * by a column the other write path leaves NULL matches nothing, and nothing
 * reads as "this has not happened yet" rather than as an error. Applied here it
 * would hide the clock origin — the founder reloads and the counter starts
 * again from zero, with nothing anywhere reporting a problem. Two grains, two
 * tables.
 *
 * ── THE PRIMARY KEY IS THE GRAIN (D6) ───────────────────────────────────────
 * AD-8 states the grain and the two stamps and names no key, so this is
 * decided here: `(organization_id, project_id)` IS the primary key, with no
 * surrogate id beside it. Three reasons, in order of weight. Arming must be one
 * atomic `INSERT … ON CONFLICT DO UPDATE` and never a read-then-write, so it
 * needs a conflict target — the primary key is the most honest one there is.
 * A surrogate id would be a second identity for a row that already has one, and
 * the id-only mutation path it invites is the exact D7 shape every repository
 * in this package is written to refuse. And a row here carries no history: "who
 * armed it" is not a fact this surface keeps, so there is nothing a synthetic
 * key would let two rows say.
 *
 * ── WHAT THIS TABLE DELIBERATELY DOES NOT CARRY ─────────────────────────────
 * There is no `slack_connected` column and there must never be one.
 * `slack_skipped_at` records that somebody walked PAST step three on purpose,
 * which the step state needs so `skipped` is distinguishable from `pending`. It
 * does NOT drive the degraded notice — that is derived from the absence of an
 * active row in `slack_connections`, which is what makes it survive a reload and
 * a revocation by construction. A cached connection flag here would be the D11
 * hand-passed wire the split exists to avoid: written by one path, read by
 * another, and stale the moment anyone else disconnects.
 */
export const firstRunState = pgTable(
  "first_run_state",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Half of the grain, and stamped by the write path for exactly that
     * reason (D2) — every read filters on `(organization_id, project_id)`
     * together, never on the project alone. A read filtered on the project id
     * by itself would compile, pass every single-tenant test, and hand one
     * organization another's clock. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * The clock origin. NULLABLE, and NULL is the fact "never armed" — never a
     * zero and never the epoch. The stage reducer's `unarmed` branch turns on
     * exactly this distinction, so a sentinel here would render a founder who
     * has not pressed anything a wait that started in 1970.
     *
     * REPLACED, NEVER APPENDED TO. "Watch again" resets the origin, so the
     * upsert overwrites this column; one row per grain is what makes "the"
     * origin a fact rather than a question of write ordering.
     */
    armedAt: timestamp("armed_at", { withTimezone: true }),
    /** Set when somebody deliberately walks past the Slack step. Independent
     * of `armed_at`: skipping is not arming, and a write that touched both
     * would start the clock for a founder who only pressed "skip". */
    slackSkippedAt: timestamp("slack_skipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "first_run_state_org_project_pk",
      columns: [table.organizationId, table.projectId],
    }),
  ],
);
