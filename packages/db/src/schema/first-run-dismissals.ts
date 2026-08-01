import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

/**
 * One member's decision to stop being shown the first-run surface, at the
 * (organization, user) grain (O-008 AD-8, AD-17).
 *
 * ── PER USER, AND THE ASYMMETRY WITH `first_run_state` IS THE DESIGN ────────
 * The clock origin is org-grained because a teammate arriving mid-wait must
 * share the wait. Dismissal is the opposite: the first-run surface is the only
 * screen this product has, so a per-ORG dismissal would let whichever member
 * pressed "hide this" first remove the entire product from every teammate's
 * account, with no route back that the UI offers. Two different questions, two
 * different grains, two tables — never one table with a nullable discriminator
 * (see `./first-run-state.ts` for what that costs).
 *
 * A member who joins later has no row here, so they get their own first run,
 * showing the organization's real state with the controls in it. That property
 * is what makes the absence of a settings surface survivable this sprint rather
 * than a lockout, and it is the reason this table is keyed the way it is.
 *
 * ── THE PRIMARY KEY IS THE GRAIN (D6) ───────────────────────────────────────
 * `(organization_id, user_id)`, decided here because AD-8 states the grain and
 * names no key. Dismissing twice is one fact, not two rows, so the write is an
 * upsert against this key rather than a read-then-insert that races itself. No
 * surrogate id: nothing about a dismissal needs a handle other than who and
 * where.
 *
 * ── CASCADE ON THE USER, DELIBERATELY UNLIKE `dismissals` ───────────────────
 * `dismissals.dismissed_by_user_id` is `set null` because a finding's
 * suppression must OUTLIVE its author — losing it would silently un-suppress
 * everything that member ever dismissed. This row is the opposite: it is a
 * preference ABOUT a user, and a deleted user has no surface left to be shown.
 * Keeping the row would be keeping a preference belonging to nobody, so the
 * cascade is the correct clean-up and not a copied default.
 */
export const firstRunDismissals = pgTable(
  "first_run_dismissals",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Half of the grain (D2). Every read filters on `(organization_id,
     * user_id)` together — a user id is exactly as client-supplied as a
     * project id, so a lookup narrowed by the user alone would answer for a
     * member of some other organization. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Stamped explicitly by the write path rather than defaulted, so the
     * moment recorded is the moment the caller means and two dismissals in the
     * same millisecond stay distinguishable in a test without sleeping. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "first_run_dismissals_org_user_pk",
      columns: [table.organizationId, table.userId],
    }),
  ],
);
