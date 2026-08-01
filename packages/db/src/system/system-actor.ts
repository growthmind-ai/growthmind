// The tenant scope a scheduled writer runs as, one home, for every one of them.
//
// Every background task in this codebase writes on behalf of an organization with no
// user present. That is the "path that steps outside the tenant context flow" the
// edge-case taxonomy names: there is no session to derive scope from, so the scope must
// come from the row being processed, never from a payload, never from a caller-supplied
// id. Each task is cron-triggered and takes no payload at all.
//
// Why this lives under src/system/ and not in @growthmind/shared Because `apps/` must
// not be able to reach it. `systemContextFor` mints a tenant context for an arbitrary
// organization with no user and no session. The exact capability the request path
// exists to withhold. A web route that could call it could scope a repository to any
// org it named.
//
// `src/system/` is the boundary that prevents this, and it is enforced, not merely
// intended: `__tests__/system/reachability.test.ts` asserts no file under `apps/`
// imports `@growthmind/db/system`, and that the vocabulary in this file is named
// nowhere outside `packages/db/src/system/`, `worker/`, and tests. `@growthmind/shared`
// is imported freely by `apps/web`, so it is precisely the wrong home for this despite
// being the natural-looking one.
//
// Why this is one module and not four It used to be four. `system-context.ts` here,
// `worker/src/tasks/analysis-tick.ts`, `worker/src/tasks/delivery-tick.ts` and
// `worker/src/analysis-lane-source.ts` each carried a byte-identical
// `tenantContextSchema.parse({ userId, organizationId, organizationName, role })`
// differing only in which actor constant it named. Beside three separate `*_ACTOR_ID` /
// `*_ACTOR_ROLE` pairs.
//
// The duplication was not the real cost. The real cost was that this module exported
// its actor under the fully generic name `SYSTEM_ACTOR_ID` while holding the
// task-specific value `"system:session-source-poll"`. A later background writer
// reaching for the obvious constant would have stamped every audit row it ever wrote as
// the session-source poller. Correctly typed, silently wrong. That is the
// stringly-typed-key failure, where the wrong string is a runtime fact rather than a
// compile error.
//
// Naming the actors in one closed union fixes exactly that: `systemContextFor` will not
// accept a string that is not a declared actor, so adding a background writer without
// giving it an identity does not compile.
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";

/**
 * Every scheduled writer that may hold a tenant scope, by name.
 *
 * These are namespaced sentinels, not fake user ids. A value here cannot collide with a
 * Better Auth user id (a UUID), and it is self-describing in any log line or future
 * audit row. "who did this?" answers itself.
 *
 * No change to `tenantContextSchema` is needed for them: `userId` and `role` are plain
 * strings there, so the shipped tenancy code is untouched and every repository still
 * takes exactly one context type. There is no second accepted context shape anywhere in
 * this codebase.
 *
 * Adding one is the point at which you decide who it is. A new background task adds its
 * actor here, and `systemContextFor` accepts it from that moment and not before.
 */
export const SYSTEM_ACTOR = {
  SESSION_SOURCE_POLL: "system:session-source-poll",
  ANALYSIS_TICK: "system:analysis-tick",
  DELIVERY_TICK: "system:delivery-tick",
} as const;

/**
 * The closed set of scheduled actors. A plain `string` would defeat the whole reason
 * this module exists. The union is what turns "wrong actor" from a silent mislabelling
 * into a type error at the call site.
 */
export type SystemActor = (typeof SYSTEM_ACTOR)[keyof typeof SYSTEM_ACTOR];

/**
 * The role stamped on every system context, so a future audit surface can tell a
 * scheduled write from a human one without parsing the actor id.
 */
export const SYSTEM_ACTOR_ROLE = "system";

/**
 * The organization a scheduled writer derives its scope from: the row it is processing.
 * Structural on purpose, a connection row, an analysis lane and a delivery lane all
 * satisfy it, and none of them has to be imported here.
 */
export interface SystemScopeSource {
  readonly organizationId: string;
  readonly organizationName: string;
}

/**
 * Builds the `TenantContext` a scheduled writer runs as, from the row it is processing.
 * Every repository the handler then constructs is org-scoped exactly as a
 * request-scoped one would be.
 *
 * Parsed through the same schema a request-derived context is, rather than returned as
 * a bare object literal: there is exactly one accepted context shape, and the scheduled
 * path is held to it too.
 */
export function systemContextFor(actor: SystemActor, scope: SystemScopeSource): TenantContext {
  return tenantContextSchema.parse({
    userId: actor,
    organizationId: scope.organizationId,
    organizationName: scope.organizationName,
    role: SYSTEM_ACTOR_ROLE,
  });
}
