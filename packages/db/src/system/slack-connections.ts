// The delivery lane's two system reads (O-008 AD-14, AD-15).
//
// Follows `pollable-connections.ts` and `analysable-projects.ts` as the named
// precedents: small, read-only, deliberately separate exports on the
// `"./system"` subpath — never re-exported from `src/index.ts`, so an import
// from the web app stays a single greppable line and the reachability test's
// guarantees extend to this module unchanged.
//
// ── ORG-AGNOSTIC BY CONTRACT, AND IT IS EASY TO GET BACKWARDS ───────────────
// Neither function takes a `TenantContext`, and that is the design rather than
// an omission. `existsAnyActiveSlackConnection` answers a question about the
// INSTALLATION — "is delivery worth composing here at all" — from a composition
// root that runs in a worker with no user and no tenant context to pass it. The
// per-organization question is answered one layer out, by the lane source
// reading each lane's channel off its OWN row (AD-15), which is where the D7
// question actually lands.
//
// NOTHING CREDENTIAL-BEARING CROSSES THIS BOUNDARY, same rule as
// `PollableConnection`: the bot token leaves `slack_connections` through
// exactly one named, org-keyed door on the repository, and it is not here.
import { asc, eq, inArray } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { slackConnections } from "../schema/slack-connections";

/**
 * Whether ANY organization on this installation has an active Slack
 * connection.
 *
 * AC-O12 is the self-host promise and it needs both halves literally: an
 * installation with no Slack at all resolves a `null` delivery composition and
 * logs a graceful absence, forever, correctly; an installation with one resolves
 * a real one. Invert this predicate and BOTH ends break at once, silently —
 * every self-hoster starts reporting lane errors instead of honest absence, and
 * every customer who HAS connected Slack stops receiving findings.
 *
 * `is_active` IS PART OF THE QUESTION, not an optimisation. `deactivate` flips
 * the flag and keeps the row, so history survives a reconnect — which means a
 * predicate that merely counted rows would report a connected installation
 * forever after the first disconnect, composing every finding against a
 * credential nobody can use.
 *
 * Written as "does one such row exist" rather than as a single-row fetch: a
 * multi-tenant installation legitimately has MANY active rows across MANY
 * organizations (the partial unique index is per organization), and a gate
 * written to expect exactly one would throw at worker boot the moment a second
 * customer connected (D3).
 */
export async function existsAnyActiveSlackConnection(db: ScopedDb): Promise<boolean> {
  const [row] = await db
    .select({ id: slackConnections.id })
    .from(slackConnections)
    .where(eq(slackConnections.isActive, true))
    .limit(1);

  return row !== undefined;
}

/**
 * One organization the delivery lane should compose for, carrying exactly what
 * a lane needs to be built — and NOTHING credential-bearing.
 *
 * `channelId` comes off the connection row, which is the whole point (FR-O13):
 * a channel id that can arrive on a payload is a way to post one organization's
 * finding into another's channel. Reading it from the lane's own row makes that
 * impossible rather than forbidden.
 */
export interface SlackDeliveryOrganization {
  readonly organizationId: string;
  /** Joined from `organization.name` so the caller can build a complete
   * `TenantContext` without a second query. */
  readonly organizationName: string;
  readonly connectionId: string;
  readonly channelId: string;
}

/**
 * Every organization with an ACTIVE Slack connection — the population the
 * delivery tick quantifies over.
 *
 * One row in, one `(organization, connection, channel)` out: there is no
 * cross-organization aggregation anywhere here, and each result carries its own
 * organization rather than inheriting one from a caller parameter (D2/D7).
 *
 * An installation with nobody connected returns `[]`, which the tick's
 * vocabulary already names as an ordinary answer rather than a fault.
 */
export async function listOrgsWithActiveSlackConnection(
  db: ScopedDb,
): Promise<SlackDeliveryOrganization[]> {
  // Field-by-field, never `select()`: the ciphertext and its key id are on this
  // table and must not ride along into a shape that leaves this module.
  const rows = await db
    .select({
      organizationId: slackConnections.organizationId,
      connectionId: slackConnections.id,
      channelId: slackConnections.channelId,
    })
    .from(slackConnections)
    .where(eq(slackConnections.isActive, true))
    .orderBy(asc(slackConnections.organizationId));

  if (rows.length === 0) {
    return [];
  }

  // The organisation name, resolved for the selected rows only — the same
  // two-step shape `claimDuePollableConnections` uses, for the same driver
  // reason.
  const orgIds = [...new Set(rows.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  return rows.map((row) => {
    // `organization_id` is a cascading FK, so a connection whose organisation
    // is missing cannot exist; throwing keeps that an assertion rather than a
    // silent nameless context downstream.
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(
        `listOrgsWithActiveSlackConnection: no organization row for connection ${row.connectionId}`,
      );
    }

    return {
      organizationId: row.organizationId,
      organizationName,
      connectionId: row.connectionId,
      channelId: row.channelId,
    };
  });
}
