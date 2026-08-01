// THE TEN FIRST-RUN ROUTE INPUT SCHEMAS (O-008, AD-16, AD-16a).
//
// Eight of them shipped with O-008. The other two — `analytics/discover` and
// `slack/channel` — arrived with the sprint that deleted the hunting from
// first run, and they are here under exactly the same terms: strict, no
// tenancy key, `.min(1)` on every field. A new route's schema going anywhere
// else is how the first non-strict one gets written.
//
// ###########################################################################
// # WHY THESE SCHEMAS LIVE IN `packages/shared` AND NOT BESIDE THEIR ROUTES.
// #
// # `apps/web` declares NO `zod` dependency, and that absence is a pinned
// # invariant with a test behind it: `apps/web/__tests__/mcp/no-direct-zod.
// # test.ts` (WIRE-Z1) asserts BOTH that the manifest never names `zod` AND
// # that `import("zod")` from that package fails to resolve at runtime. Its
// # header states the reason the invariant survived its own original
// # justification being withdrawn: ONE PACKAGE OWNS THE SCHEMAS, so an
// # advertised shape and the validator that enforces it cannot drift.
// #
// # So `z.strictObject()` — which AD-16a makes the REQUIRED constructor for
// # every first-run route input — cannot be written in an `apps/web` route
// # file as this tree stands. It is written here, and each route module
// # re-exports the one it owns as `inputSchema`. AD-2 argues for exactly this
// # independently: "the routes and the components are on opposite sides of a
// # serialization boundary and a shape defined on one side is a D11 wire
// # waiting to be severed".
// ###########################################################################
//
// ── AD-16: NO SCHEMA HERE DECLARES A TENANCY KEY, AND NONE EVER MAY ─────────
//
// There is no `projectId` and no `organizationId` below, on any of the ten.
// Tenancy comes from the session: `getTenantContext()` → `ensureProject(db,
// ctx)` → `createXRepo(db, ctx)`. FR-O24 asked that a client-supplied project
// id be resolved against the caller's org before it reaches a query; the
// strictly stronger form is free here, because A VALUE THAT CANNOT ARRIVE
// CANNOT BE MIS-SCOPED.
//
// ── AD-16a: `z.strictObject`, NOT `z.object`, AND THE DIFFERENCE IS INVISIBLE
// ── TO ENUMERATION ─────────────────────────────────────────────────────────
//
// Measured on the installed zod 4.4.3:
//
//     z.object       + projectId -> success=true   data={"stepId":"…"}   200
//     z.strictObject + projectId -> success=false  code=unrecognized_keys 400
//     Object.keys(shape) — IDENTICAL for both: [ "stepId" ]
//
// A plain `z.object()` ACCEPTS a client-supplied tenancy id, SILENTLY STRIPS
// it, and answers 200 — while every key-enumeration test stays green. Six of
// the ten schemas below declare no field at all, and those are the sharp
// end: `z.object({})` accepts ANYTHING AT ALL, `z.strictObject({})` refuses it
// by name. Every schema in this file is `z.strictObject`. **A plain
// `z.object()` on a first-run route is a defect regardless of its declared
// keys** — `apps/web/__tests__/api/first-run/status.route.test.ts` parses a
// real body through every one of these and asserts
// `issue.code === "unrecognized_keys"`, and proves its own detector bites
// against a planted plain `z.object()` first.
//
// ── EVERY FIELD IS `.min(1)`, FOR THE REASON `connectInputSchema` STATES ────
//
// An empty host, project number, personal key, bot token or channel id is
// never a legitimate submission, and letting one through reaches an encryption
// call site or a third party's API with a value nothing validated.
import { z } from "zod";

/**
 * `GET /api/first-run/status` — the whole reconciled payload, and no input.
 *
 * EMPTY AND STRICT, not absent. A GET carries no body, but this schema is what
 * refuses a request that grew one, and it is the schema §9's tenancy block
 * parses a `{ projectId }` body through on every route including this one.
 */
export const firstRunStatusInputSchema = z.strictObject({});

/**
 * `POST /api/first-run/analytics/discover` — the key, and nothing else.
 *
 * This route exists to delete a hunt. `connect` below needs a project number,
 * and the only way a founder gets one is by leaving this product, finding the
 * vendor's settings page and copying a number back. The personal key on its own
 * is enough to ask the vendor which projects it can see, so the number is
 * something we fetch rather than something we ask for — which is why NO project
 * id appears here, neither the customer's nor the vendor's.
 *
 * NO tenancy key either, for the reason the header gives: nothing on this route
 * chooses whose organization the answer belongs to.
 */
export const firstRunAnalyticsDiscoverInputSchema = z.strictObject({
  /** Held for the lifetime of the call. Never logged, never returned. */
  personalApiKey: z.string().min(1),
  /**
   * Absent on the common path, and that is the design rather than a
   * convenience. The known regions are probed in order, and the host field is
   * revealed to the customer only once every one of them has refused — so a
   * body carrying a host is a self-hoster answering a question we earned the
   * right to ask. Optional here is what lets the common path stay silent about
   * regions the customer should never have to think about.
   */
  host: z.string().min(1).optional(),
});
export type FirstRunAnalyticsDiscoverInput = z.infer<typeof firstRunAnalyticsDiscoverInputSchema>;

/**
 * `POST /api/first-run/analytics/connect` — AD-16's row, transcribed.
 *
 * NO `sourceKind`. The vendor is named once, at the composition root that
 * builds the source factory, and never on the wire — a client that could
 * choose the adapter would be choosing which vendor's API we call on the
 * customer's behalf.
 *
 * NO `projectId`. The org's project is derived by `ensureProject(db, ctx)`.
 */
export const firstRunAnalyticsConnectInputSchema = z.strictObject({
  /** The customer's region address, e.g. `https://eu.i.posthog.com`. */
  host: z.string().min(1),
  /** The vendor's numeric project id, held as opaque text. */
  sourceProjectId: z.string().min(1),
  /** Held for the lifetime of the call. Never logged, never returned. */
  personalApiKey: z.string().min(1),
});
export type FirstRunAnalyticsConnectInput = z.infer<typeof firstRunAnalyticsConnectInputSchema>;

/** `POST /api/first-run/analytics/disconnect` — org-wide, and no input. */
export const firstRunAnalyticsDisconnectInputSchema = z.strictObject({});

/**
 * `POST /api/first-run/slack/connect` — a pasted bot token and a channel id.
 *
 * AD-24: this sprint ships no Slack OAuth, so a pasted token is the mechanism.
 * The token is sealed into an `encryptSecret` envelope by the route and never
 * comes back out of any repository method (AD-20).
 */
export const firstRunSlackConnectInputSchema = z.strictObject({
  botToken: z.string().min(1),
  /** FR-O13: stored on the row. Every later post reads it from there. */
  channelId: z.string().min(1),
});
export type FirstRunSlackConnectInput = z.infer<typeof firstRunSlackConnectInputSchema>;

/**
 * `POST /api/first-run/slack/channel` — the one moment a channel is chosen.
 *
 * This looks like the payload `firstRunSlackTestInputSchema` below refuses, and
 * the difference is which question is being answered. A connection can now be
 * made before a channel exists on it, so choosing is its own step: the server
 * lists the channels the connected workspace actually has, and this route
 * records which one of them the customer picked. Proving the id came from that
 * list is the route's job — the schema's job ends at "text somebody typed is
 * not it".
 *
 * After this, nothing accepts a channel on the wire again. Every later post
 * reads it from the stored row (FR-O13), so no caller can redirect an
 * organization's announcement by naming a channel at post time.
 */
export const firstRunSlackChannelInputSchema = z.strictObject({
  channelId: z.string().min(1),
});
export type FirstRunSlackChannelInput = z.infer<typeof firstRunSlackChannelInputSchema>;

/**
 * `POST /api/first-run/slack/test` — no input, and that is FR-O13.
 *
 * The channel is read from the stored `slack_connections` row, never accepted
 * from a payload: a caller that could name a channel could post this
 * organization's announcement into a channel it does not own.
 */
export const firstRunSlackTestInputSchema = z.strictObject({});

/** `POST /api/first-run/slack/skip` — records the skip. No input. */
export const firstRunSlackSkipInputSchema = z.strictObject({});

/**
 * `POST /api/first-run/arm` — the clock origin. No input.
 *
 * The stamp is the SERVER's, taken from the route's injected clock, so a
 * client cannot decide when its own wait started.
 */
export const firstRunArmInputSchema = z.strictObject({});

/**
 * `POST /api/first-run/dismiss` — per user (AD-17). No input.
 *
 * The user id comes from the session and is never a parameter on the wire: a
 * body-supplied user id would let one member retire the surface for another.
 */
export const firstRunDismissInputSchema = z.strictObject({});
