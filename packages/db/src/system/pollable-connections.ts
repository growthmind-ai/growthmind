// The two system reads the scheduler needs (O-003 D-10, FR-23).
//
// Following `resolveWriteKeyForIngest` as the named precedent: a small,
// read-only, deliberately separate export rather than a second context type
// folded into the scoped repositories.
//
// This module is reachable ONLY through the "./system" subpath in
// package.json — it is not exported from src/index.ts — so an import from the
// web app is a single greppable line, and a committed test asserts none
// exists.
//
// TYPED STUB (O-003 scaffold): the types are final; the bodies throw.
import type { SessionSourceKind } from "@growthmind/shared";

import type { ScopedDb } from "../repositories/types";

/**
 * A claimed connection, carrying exactly what the poll needs to run and
 * NOTHING credential-bearing. There is no ciphertext field, no key id, and no
 * key material of any kind: the credential is fetched separately, by a
 * function whose name makes every call site auditable by grep. A test asserts
 * this type has no credential-bearing field, at both the type and the runtime
 * level.
 */
export interface PollableConnection {
  readonly id: string;
  readonly organizationId: string;
  /** Joined from `organization.name` so `systemTenantContextFor` can build a
   * complete `TenantContext` without a second query. */
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
 * THE ATOMIC CLAIM (D-7 / D6). One statement:
 *
 *   UPDATE project_connections
 *      SET next_poll_at = $now + poll_interval_seconds
 *    WHERE is_active AND next_poll_at <= $now
 *    ... LIMIT $limit
 *   RETURNING ...
 *
 * The claim IS the lock — there is no check-then-write anywhere, so two
 * overlapping cron runs can never claim the same connection. Returns nothing
 * for an inactive connection or one not yet due.
 */
export function claimDuePollableConnections(
  _db: ScopedDb,
  _params: { now: Date; limit: number },
): Promise<PollableConnection[]> {
  throw new Error("TYPED STUB (O-003 scaffold): claimDuePollableConnections");
}

/**
 * The ONE path to a stored credential, and it is ORG-KEYED — there is no
 * id-only route to key material anywhere in this package. Its name is
 * deliberately blunt so every call site shows up in one grep.
 *
 * Returns the envelope and its key fingerprint, never a decrypted value:
 * decryption happens at the composition root, against a key the caller
 * resolved, and fails CLOSED (F-11) — an undecryptable credential is a
 * `misconfigured` failure with no request made, never a fallback to an env
 * key and never an unauthenticated call.
 */
export function readConnectionCredential(
  _db: ScopedDb,
  _params: { connectionId: string; organizationId: string },
): Promise<{ ciphertext: string; keyId: string } | null> {
  throw new Error("TYPED STUB (O-003 scaffold): readConnectionCredential");
}
