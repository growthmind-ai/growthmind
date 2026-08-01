import { z } from "zod";

// Every shape the `SessionSource` port speaks, plus the shapes `packages/db` stores and
// `packages/adapters` produces. Zod is the single runtime source of truth;
// `packages/db`'s enum columns are pinned to these unions via `satisfies`, so a typo'd
// column value is a compile error.
//
// These are pure declarations, so they are real and final. Wave 0b's tests assert
// against them directly.

/**
 * One member today. The vendor name does not leak past the composition root: the
 * worker's handler switches exhaustively over this union and imports
 * `createPostHogSessionSource` by name. There is no registry, no factory map, no
 * dynamic lookup (grep-asserted).
 */
export const sessionSourceKindSchema = z.enum(["posthog"]);
export type SessionSourceKind = z.infer<typeof sessionSourceKindSchema>;

/**
 * Terminal failure classes. Branching is on the response envelope's `code`, never on
 * the HTTP status alone (sec-d), and PostHog's own `detail` text is never surfaced
 * verbatim. It is mapped to one of these plus a message from `./messages.ts`.
 *
 * There is deliberately no `forbidden` member: both observed auth failures are 401,
 * never 403, so no 403 branch is coded.
 */
export const sourceFailureCodeSchema = z.enum([
  "invalid_credentials",
  "project_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
]);
export type SourceFailureCode = z.infer<typeof sourceFailureCodeSchema>;

export const sourceFailureSchema = z.object({
  code: sourceFailureCodeSchema,
  /** Plain English, from `./messages.ts`. Never PostHog's `detail`. */
  message: z.string(),
});
export type SourceFailure = z.infer<typeof sourceFailureSchema>;

/** Persisted health on the connection row. The DB owns this, not a `health` port
 * method (a second source of truth would reintroduce the failure of gating on a
 * transient signal). */
export const connectionHealthSchema = z.enum(["validating", "healthy", "failing", "disconnected"]);
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>;

/** How `inferred_internal_domain` was arrived at, so the value can be shown before it
 * takes effect (architecture; OQ-5 hand-off to). */
export const internalDomainProvenanceSchema = z.enum(["org_creator_email"]);
export type InternalDomainProvenance = z.infer<typeof internalDomainProvenanceSchema>;

/**
 * The three-state identity result. The load-bearing part is that "we don't know" can
 * never read as "definitely a real user":
 * `resolved`, an email was obtained; only its domain crosses into persistence
 *  (product-decisions: never the address).
 * `absent`, a completed lookup proved this identity has no email. A fact.
 * `unresolved`, we did not find out (no distinct id, the lookup failed, was
 *  rate-limited, or the per-run budget was exhausted).
 */
export const identityResolutionSchema = z.enum(["resolved", "absent", "unresolved"]);
export type IdentityResolution = z.infer<typeof identityResolutionSchema>;

// Port I/O

export const sessionSourceValidationSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), checkedAt: z.date() }),
  z.object({ ok: z.literal(false), checkedAt: z.date(), failure: sourceFailureSchema }),
]);
export type SessionSourceValidation = z.infer<typeof sessionSourceValidationSchema>;

export const sessionSourcePullRequestSchema = z.object({
  /** `null` means never polled. The walk requests `after = watermarkAt −
   * OVERLAP_WINDOW_SECONDS`. */
  watermarkAt: z.date().nullable(),
  /** Set when a previous walk stopped on the page cap: the `before` value of the page
   * it stopped at, resumed before a new forward pass. It is the wire value verbatim,
   * never reconstructed. */
  backfillBefore: z.string().nullable(),
  /** Hard page cap for this invocation. */
  maxPages: z.number().int().positive(),
});
export type SessionSourcePullRequest = z.infer<typeof sessionSourcePullRequestSchema>;

/** One assembled session crossing the port. Carries the email domain only. No pull
 * result ever carries an address (product-decisions). */
export const sourceSessionSchema = z.object({
  sessionKey: z.string(),
  /** The keyed hmac hash of PostHog's `distinct_id` (`../sessions/identity-key.ts`,
   * security audit), never the raw value; `identify` is routinely called with an
   * email address as the distinct id, so only the hash may cross this port boundary.
   * Named `identityKey`, not `identityId`, because the `identities` table full
   * stitching creates does not exist yet and a `_id` column with no referent would
   * become a rename migration. */
  identityKey: z.string().nullable(),
  identityEmailDomain: z.string().nullable(),
  identityResolution: identityResolutionSchema,
  userAgent: z.string().nullable(),
  entryUrlPath: z.string().nullable(),
  startedAt: z.date(),
  lastEventAt: z.date(),
});
export type SourceSession = z.infer<typeof sourceSessionSchema>;

/** One event crossing the port. `sourceEventId` is PostHog's server-assigned `id` (row
 * 3). The idempotency key, with no derived input, so it is not a fork risk. */
export const sourceEventSchema = z.object({
  sourceEventId: z.string(),
  /** Links to `sourceSessionSchema.sessionKey` within one pull result. */
  sessionKey: z.string(),
  /** PostHog's event name, as-is, never re-authored. */
  name: z.string(),
  /** PostHog's client-declared event time (row 4), parsed, never string-compared. */
  occurredAt: z.date(),
  urlPath: z.string().nullable(),
});
export type SourceEvent = z.infer<typeof sourceEventSchema>;

/** Counters every pull carries, success or failure, so a run row can be finished
 * honestly on either path. */
const pullTelemetry = {
  pagesFetched: z.number().int().nonnegative(),
  /** Malformed items skipped and counted, never silently discarded. */
  droppedMalformed: z.number().int().nonnegative(),
  identityLookupsUsed: z.number().int().nonnegative(),
  eventsReceived: z.number().int().nonnegative(),
};

export const sessionSourcePullResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    sessions: z.array(sourceSessionSchema),
    events: z.array(sourceEventSchema),
    /** The newest observed event time. Page 1, item 0 (row 1). Never accumulated from
     * the last page. `null` when the walk saw nothing. */
    newestObservedAt: z.date().nullable(),
    /** `true` only when the walk terminated on a literal `null` cursor or on crossing
     * the previous watermark. `false` means the page cap was hit. The caller must not
     * advance the watermark. */
    contiguous: z.boolean(),
    /** The `before` cursor to resume the unfinished backward walk from. Non-null
     * exactly when `contiguous` is `false`. */
    resumeBefore: z.string().nullable(),
    ...pullTelemetry,
  }),
  z.object({
    ok: z.literal(false),
    failure: sourceFailureSchema,
    /** The walk is newest-first, so a mid-walk failure has already retrieved the newest
     * events. The caller persists these and does not advance the watermark. This is
     * what makes the "partial progress survives" a type-level guarantee rather than a
     * hope. */
    partialSessions: z.array(sourceSessionSchema),
    partialEvents: z.array(sourceEventSchema),
    ...pullTelemetry,
  }),
]);
export type SessionSourcePullResult = z.infer<typeof sessionSourcePullResultSchema>;

// Connection DTOs, what reads. Never credential-bearing.

/**
 * ── THE THREE DATES ARE COERCED, AND THAT IS A D5 FIX RATHER THAN A LOOSENING
 *
 * This shape STARTED as a server-side DTO and BECAME a wire shape in O-008:
 * AD-3 puts a `ConnectionState` — which embeds this summary — inside
 * `OnboardingCounterView`, the narrowed counter the status route serialises to
 * the browser. JSON has no `Date`, so the moment that happened these three
 * fields began leaving as `Date` and arriving as ISO strings, and a plain
 * `z.date()` could no longer parse the very payload the schema describes.
 * Measured: `connectionStateSchema.safeParse(JSON.parse(JSON.stringify(state)))`
 * failed on `connection.connectedAt` with `expected date, received string`,
 * while the `not_connected` member — the only one carrying no date — passed.
 *
 * `z.coerce.date()` is the same answer `onboardingFindingSchema` already gives
 * for `windowStart` and `windowEnd`, in that file's own words: "JSON has no
 * `Date` … One schema guards both directions (D5)". It is a strict widening,
 * not a weakening — a `Date` still parses to itself, an ISO string parses to a
 * `Date`, and a value that is neither is still refused.
 */
export const connectionSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  sourceKind: sessionSourceKindSchema,
  host: z.string(),
  sourceProjectId: z.string(),
  isActive: z.boolean(),
  health: connectionHealthSchema,
  healthReasonCode: sourceFailureCodeSchema.nullable(),
  healthReasonMessage: z.string().nullable(),
  healthCheckedAt: z.coerce.date().nullable(),
  /** `null` means never polled. Distinct from "polled and found nothing". */
  watermarkAt: z.coerce.date().nullable(),
  backfillBefore: z.string().nullable(),
  pollIntervalSeconds: z.number().int().positive(),
  connectedAt: z.coerce.date(),
  inferredInternalDomain: z.string().nullable(),
  internalDomainProvenance: internalDomainProvenanceSchema.nullable(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

/**
 * The seven states needs, pairwise distinguishable by construction and each carrying
 * its own plain-English message (`./messages.ts`). A screen can never land in an "I
 * don't know what this is" branch, and no two states share a string.
 */
export const connectionStateSchema = z.discriminatedUnion("status", [
  /** No connection row at all. Distinct from a zero count. */
  z.object({ status: z.literal("not_connected") }),
  /** Credentials accepted, first check still running. */
  z.object({ status: z.literal("validating"), connection: connectionSummarySchema }),
  /** Connected, but no poll has completed yet. */
  z.object({ status: z.literal("connected_never_polled"), connection: connectionSummarySchema }),
  /** Polled successfully and found nothing. A real, reportable answer. */
  z.object({ status: z.literal("connected_no_events_yet"), connection: connectionSummarySchema }),
  /** Polled successfully and events are arriving. */
  z.object({ status: z.literal("connected_receiving"), connection: connectionSummarySchema }),
  /** The last check or poll failed; the reason is on the connection. */
  z.object({ status: z.literal("failing"), connection: connectionSummarySchema }),
  /** Deliberately disconnected; the rows we already have are kept. */
  z.object({ status: z.literal("disconnected"), connection: connectionSummarySchema }),
]);
export type ConnectionState = z.infer<typeof connectionStateSchema>;
export type ConnectionStateStatus = ConnectionState["status"];

/**
 * The `connect` boundary's own input (security audit). This is the one shape that
 * arrives at `packages/db`'s `ConnectionsService.connect` from outside a typed caller.
 * Today the tests and the connect-time wire proof, tomorrow an API route parsing an
 * untrusted request body, so it gets a runtime schema like every other cross-boundary
 * shape here, rather than trusting a bare TypeScript interface a runtime value is
 * merely shaped like. Lives here, not in `packages/db`, so packages/db never needs its
 * own direct `zod` dependency for one schema. It already imports every other shape in
 * this file the same way.
 *
 * `.min` on every string field: an empty `projectId`, `host`, `sourceProjectId`, or
 * `personalApiKey` is never a legitimate connect attempt, and reaching the encryption
 * call site or a database write with one is a caller bug worth failing loudly and
 * immediately on.
 */
export const connectInputSchema = z.object({
  projectId: z.string().min(1),
  sourceKind: sessionSourceKindSchema,
  host: z.string().min(1),
  sourceProjectId: z.string().min(1),
  personalApiKey: z.string().min(1),
});
export type ConnectInput = z.infer<typeof connectInputSchema>;

/**
 * Why a connect attempt was refused. `second_source` falls out of the partial unique
 * index. The database refuses it, never a prior read.
 *
 * Every member of `sourceFailureCodeSchema` appears here, `rate_limited` included:
 * validation is a real call to the customer's analytics account, so every way that call
 * can fail has to be sayable to the customer. That containment is what gives
 * `SOURCE_FAILURE_MESSAGES` (./messages.ts) exactly one home for its strings instead of
 * a second, drifting copy.
 */
export const connectRefusalCodeSchema = z.enum([
  "second_source",
  "invalid_credentials",
  "project_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
]);
export type ConnectRefusalCode = z.infer<typeof connectRefusalCodeSchema>;

export const connectRefusalSchema = z.object({
  code: connectRefusalCodeSchema,
  /** Plain English, from `./messages.ts`. For `second_source` it names the existing
   * connection and the cutover path. */
  message: z.string(),
});
export type ConnectRefusal = z.infer<typeof connectRefusalSchema>;

export const connectResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    connection: connectionSummarySchema,
    /** The one bounded inline first pull, so the counter is non-zero the moment
     * onboarding step 2 completes. */
    firstPullEventsSeen: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false), refusal: connectRefusalSchema }),
]);
export type ConnectResult = z.infer<typeof connectResultSchema>;

// Poll-run shapes

export const pollRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type PollRunStatus = z.infer<typeof pollRunStatusSchema>;

/**
 * An empty page is never authoritative: a connection that is permanently zero must be
 * visible rather than indistinguishable from a healthy quiet one, so these are recorded
 * distinctly.
 */
export const pollRunOutcomeSchema = z.enum(["with_events", "no_new_events"]);
export type PollRunOutcome = z.infer<typeof pollRunOutcomeSchema>;
