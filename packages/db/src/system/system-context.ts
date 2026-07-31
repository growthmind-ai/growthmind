// The session-source poll's tenant scope (D-10, FR-23).
//
// The scope is derived from the connection ROW being processed — never from a
// payload and never from a caller-supplied id. There is no payload: the task
// is cron-triggered.
//
// ── THE ACTOR VOCABULARY MOVED, AND WHY ─────────────────────────────────────
// This file used to own `SYSTEM_ACTOR_ID`, `SYSTEM_ACTOR_ROLE` and the
// `tenantContextSchema.parse(...)` call itself. It owns none of them now: they
// live in `./system-actor`, beside the actors for every other scheduled writer
// — still inside `src/system/`, so the reachability boundary is unchanged.
//
// The move was not about the four duplicated lines. `SYSTEM_ACTOR_ID` was a
// fully generic name holding the entirely specific value
// `"system:session-source-poll"`. Any later background writer that reached for
// the obvious constant would have stamped every audit row it wrote as the
// session-source poller — correctly typed, silently wrong (D9). The shared
// module replaces the loose string with a closed `SystemActor` union, so naming
// the wrong actor is now a compile error rather than a mislabelled row.
import type { TenantContext } from "@growthmind/shared";

import type { PollableConnection } from "./pollable-connections";
import { SYSTEM_ACTOR, systemContextFor } from "./system-actor";

/**
 * Builds the `TenantContext` the poll runs as, from the claimed row itself.
 * Every repository the handler then constructs is org-scoped exactly as a
 * request-scoped one would be.
 *
 * Kept as a named wrapper rather than inlining `systemContextFor` at the call
 * site: this is the one place that decides the poll's actor, and a caller that
 * had to name the actor itself could name a different one.
 */
export function systemTenantContextFor(connection: PollableConnection): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.SESSION_SOURCE_POLL, connection);
}
