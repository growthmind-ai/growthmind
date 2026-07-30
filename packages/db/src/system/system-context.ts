// The worker's tenant scope (O-003 D-10, FR-23).
//
// The scope is derived from the connection ROW being processed — never from a
// payload and never from a caller-supplied id. There is no payload: the task
// is cron-triggered.
//
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";

import type { PollableConnection } from "./pollable-connections";

/**
 * A NAMESPACED SENTINEL, not a fake user id. It cannot collide with a Better
 * Auth user id (a UUID), and it is self-describing in any log line or future
 * audit row — "who did this?" answers itself.
 *
 * No change to `tenantContextSchema` is needed for it: `userId` and `role`
 * are plain strings there, so the shipped tenancy code is untouched and every
 * repository still takes exactly one context type. There is no second
 * accepted context shape anywhere in this package.
 */
export const SYSTEM_ACTOR_ID = "system:session-source-poll";

/** The role stamped on a system context, so a future audit surface can tell
 * a scheduled write from a human one without parsing the actor id. */
export const SYSTEM_ACTOR_ROLE = "system";

/**
 * Builds the `TenantContext` the poll runs as, from the claimed row itself.
 * Every repository the handler then constructs is org-scoped exactly as a
 * request-scoped one would be.
 */
export function systemTenantContextFor(connection: PollableConnection): TenantContext {
  // Parsed through the SAME schema a request-derived context is, rather than
  // returned as a bare object literal: there is exactly one accepted context
  // shape in this package, and the scheduled path is held to it too.
  return tenantContextSchema.parse({
    userId: SYSTEM_ACTOR_ID,
    organizationId: connection.organizationId,
    organizationName: connection.organizationName,
    role: SYSTEM_ACTOR_ROLE,
  });
}
