// The two system reads the scheduler needs.
//
// Following `resolveWriteKeyForIngest` as the named precedent: a small, read-only,
// deliberately separate export rather than a second context type folded into the scoped
// repositories.
//
// This module is reachable only through the "./system" subpath in package.json (it is
// not exported from src/index.ts) so an import from the web app is a single greppable
// line, and a committed test asserts none exists.
import type { SessionSourceKind } from "@growthmind/shared";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { projectConnections } from "../schema/project-connections";

/**
 * A claimed connection, carrying exactly what the poll needs to run and nothing
 * credential-bearing. There is no ciphertext field, no key id, and no key material of
 * any kind: the credential is fetched separately, by a function whose name makes every
 * call site auditable by grep. A test asserts this type has no credential-bearing
 * field, at both the type and the runtime level.
 */
export interface PollableConnection {
  readonly id: string;
  readonly organizationId: string;
  /** Joined from `organization.name` so `systemTenantContextFor` can build a complete
   * `TenantContext` without a second query. */
  readonly organizationName: string;
  readonly projectId: string;
  readonly sourceKind: SessionSourceKind;
  readonly host: string;
  readonly sourceProjectId: string;
  /** `null` means never polled. */
  readonly watermarkAt: Date | null;
  readonly backfillBefore: string | null;
  readonly pollIntervalSeconds: number;
  readonly connectedAt: Date;
  readonly inferredInternalDomain: string | null;
}

/**
 * The atomic claim. One statement:
 *
 * Update project_connections
 *  Set next_poll_at = $now + poll_interval_seconds
 *  Where is_active and next_poll_at <= $now
 * ... LIMIT $limit
 * Returning...
 *
 * The claim IS the lock. There is no check-then-write anywhere, so two overlapping cron
 * runs can never claim the same connection. Returns nothing for an inactive connection
 * or one not yet due.
 */
export async function claimDuePollableConnections(
  db: ScopedDb,
  params: { now: Date; limit: number },
): Promise<PollableConnection[]> {
  if (params.limit <= 0) {
    return [];
  }

  // The inner select is the candidate set; `FOR UPDATE SKIP LOCKED` means a concurrent
  // tick skips rows this one already holds rather than blocking on them, so overlapping
  // cron runs partition the work instead of serialising. `ORDER BY next_poll_at` keeps
  // the oldest-overdue connection first, so a backlog longer than `limit` drains fairly
  // rather than starving a tail.
  const due = db
    .select({ id: projectConnections.id })
    .from(projectConnections)
    .where(
      and(eq(projectConnections.isActive, true), lte(projectConnections.nextPollAt, params.now)),
    )
    .orderBy(asc(projectConnections.nextPollAt))
    .limit(params.limit)
    .for("update", { skipLocked: true });

  // One statement. The cursor moves as part of the same write that selects the row, so
  // there is no window in which a second tick can see the row still due. The claim IS
  // the lock.
  const claimed = await db
    .update(projectConnections)
    .set({
      nextPollAt: sql`${params.now}::timestamptz + (${projectConnections.pollIntervalSeconds} * interval '1 second')`,
    })
    .where(inArray(projectConnections.id, due))
    .returning();

  if (claimed.length === 0) {
    return [];
  }

  // The organization name, resolved for the claimed rows only. Kept out of the claim
  // statement deliberately: a projected `RETURNING` across the joined shape does not
  // resolve over the production/PGlite driver union, and this read touches at most
  // `limit` organizations by primary key.
  const orgIds = [...new Set(claimed.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  // Field-by-field, never a spread: `credential_ciphertext` and `credential_key_id` are
  // on the row this statement returned and must not ride along into the claimed shape
  // under any name (item 86).
  return claimed.map((row) => {
    // `organization_id` is a FK with `ON DELETE CASCADE`, so a claimed row whose
    // organization is missing cannot exist. Throwing rather than defaulting keeps that
    // an assertion: a nameless `TenantContext` flowing into the pipeline would be a
    // silent degrade, and this one is loud.
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(
        `claimDuePollableConnections: no organization row for claimed connection ${row.id}`,
      );
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName,
      projectId: row.projectId,
      sourceKind: row.sourceKind,
      host: row.host,
      sourceProjectId: row.sourceProjectId,
      watermarkAt: row.watermarkAt,
      backfillBefore: row.backfillBefore,
      pollIntervalSeconds: row.pollIntervalSeconds,
      connectedAt: row.connectedAt,
      inferredInternalDomain: row.inferredInternalDomain,
    };
  });
}

/**
 * The one path to a stored credential, and it is org-keyed. There is no id-only route
 * to key material anywhere in this package. Its name is deliberately blunt so every
 * call site shows up in one grep.
 *
 * Returns the envelope and its key fingerprint, never a decrypted value: decryption
 * happens at the composition root, against a key the caller resolved, and fails closed
 * . An undecryptable credential is a `misconfigured` failure with no request
 * made, never a fallback to an env key and never an unauthenticated call.
 */
export async function readConnectionCredential(
  db: ScopedDb,
  params: { connectionId: string; organizationId: string },
): Promise<{ ciphertext: string; keyId: string } | null> {
  // Both predicates, always. A connection id alone is never enough to reach key
  // material, so a caller that has an id but named the wrong organization gets `null`
  // rather than a credential.
  const [row] = await db
    .select({
      ciphertext: projectConnections.credentialCiphertext,
      keyId: projectConnections.credentialKeyId,
    })
    .from(projectConnections)
    .where(
      and(
        eq(projectConnections.organizationId, params.organizationId),
        eq(projectConnections.id, params.connectionId),
      ),
    )
    .limit(1);

  return row ? { ciphertext: row.ciphertext, keyId: row.keyId } : null;
}
