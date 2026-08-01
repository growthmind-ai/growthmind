import { randomUUID } from "node:crypto";

import type { DismissalAction } from "@growthmind/shared";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/shared's Zod union. Exactly one
// member at MVP, `get_it_fixed` is a later outcome's and is deliberately not added
// speculatively (`packages/shared/src/signatures/types.ts`).
const DISMISSAL_ACTIONS = ["not_useful"] as const satisfies readonly [
  DismissalAction,
  ...DismissalAction[],
];

/**
 * A customer's response to a finding. Exactly one action at MVP: `not_useful`.
 *
 * Org-wide and permanent, out loud (architecture.md:528-529) "'Not useful' is a
 * permanent org-wide suppression". This table is that decision made durable. Any org
 * member's dismissal suppresses the signature for the whole org (— see the flagship
 * teammate test), forever, by design.
 *
 * No undo at MVP (OQ-2, decided) There is no `undismissed_at` column and no reversal
 * path in this sprint. The recourse gap is real and is accepted, not overlooked:
 * `architecture.md:528-529` already decided org-wide + permanent, and because the
 * suppression policy is versioned (`packages/core/src/findings/suppression-policy.ts`),
 * adding an undo later is a bounded change (an `undismissed_at` column plus a policy
 * v2) not a migration of this table's meaning.
 *
 * NO FK ON `finding_id` (closes OQ-5) `findings` belongs to the concurrently-shipping
 * sprint; the collision contract forbids touching it. The FK arrives in a later sprint
 * once that table exists in this branch's history. `signature` is carried on this row
 * so suppression can resolve without joining `findings` at all.
 *
 * Deferral, named heir. `findings` now exists (`packages/db/src/schema/findings.ts`),
 * so the missing-table reason above has expired, and the FK is still not added, for a
 * different and cited reason: this table's shipped suites insert rows carrying
 * synthetic `finding_id` values that reference no `findings` row, and those suites are
 * frozen. The `ALTER TABLE … ADD CONSTRAINT` is cheap; repairing frozen fixtures is
 * not, and doing it inside That decision is precisely the scope creep that sprint
 * forbids. Heir: the sprint that lands the findings producer end to end (the
 * corpus-reader heir of), the same sprint that must migrate these fixtures. Owns
 * adding the FK. This paragraph is the deferral's only git-tracked home: sprint task
 * files are gitignored, so a deferral recorded only there does not exist.
 *
 * `dismissedByUserId` IS `SET NULL`, never cascade a dismissal must outlive its author.
 * If deleting a user row cascaded into deleting the dismissals they made, every
 * signature they ever dismissed would silently UN-suppress the moment their account was
 * removed. A identity-detachment failure with no error and no audit trail. `set null`
 * keeps the dismissal (and therefore the suppression) alive; only the attribution is
 * lost.
 *
 * The unmapped-responder refusal is out of scope here (architecture.md
 * 529-532) Architecture requires the Slack responder to map to an org member, with a
 * polite in-thread refusal for an unmapped one. That check belongs to a later outcome's
 * Slack-delivery boundary (the thing that receives the interaction payload). This
 * table's absence of that check is a boundary, not a gap: by the time a row reaches
 * here, `dismissedByUserId` is already a resolved member id or `null` for a
 * system/backfill path, never an unmapped Slack user id.
 */
export const dismissals = pgTable(
  "dismissals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Stamped but never filtered on (the declared exemption). Kept for future
     * per-project reads and for the FK a later sprint adds. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** NO FK, see the table header. */
    findingId: text("finding_id").notNull(),
    /** Carried so suppression resolves without a join to `findings`. */
    signature: text("signature").notNull(),
    action: text("action", { enum: DISMISSAL_ACTIONS }).notNull(),
    /** Nullable, `onDelete: "set null"`, see the table header. */
    dismissedByUserId: text("dismissed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("dismissals_org_finding_action_key").on(
      table.organizationId,
      table.findingId,
      table.action,
    ),
    index("dismissals_organization_id_idx").on(table.organizationId),
    index("dismissals_org_signature_idx").on(table.organizationId, table.signature),
  ],
);
