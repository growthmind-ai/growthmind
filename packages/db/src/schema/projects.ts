import { randomUUID } from "node:crypto";

import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Set ONLY by the automatic first-run provisioning path (O-008 AD-7), to
     * the literal `org:<organizationId>`. A project created by any other path
     * leaves this NULL, and Postgres permits unlimited NULLs in a unique index
     * — so the constraint below makes auto-provisioning idempotent WITHOUT
     * deciding that an organization may only ever hold one project.
     *
     * That restraint is the point. `UNIQUE (organization_id)` would have been
     * the obvious constraint and would have answered a permanent product
     * question — one project per organization, yes or no — silently, inside an
     * onboarding sprint, in a schema line nobody read. The question is open and
     * this column keeps it open: it constrains the auto path and nothing else.
     *
     * D12: a deterministic key is exactly as stable as its least stable input,
     * and this one's ONLY input is `organization.id` — a primary key that never
     * churns. No derived id, no path, no normalised serialisation, so there is
     * no ancestry to track and no fork for a rename to cause.
     */
    provisioningKey: text("provisioning_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("projects_organization_id_idx").on(table.organizationId),
    // The idempotency this table previously had no way to express (D6): two
    // concurrent provisions for one organization race to the same deterministic
    // key, the database refuses the second, and the loser re-reads the winner.
    // Settled by a constraint, never by a prior read.
    uniqueIndex("projects_provisioning_key_uidx").on(table.provisioningKey),
  ],
);
