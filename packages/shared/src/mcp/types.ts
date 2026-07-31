import { z } from "zod";

import { exclusionReasonSchema } from "../exclusions/types";

// The read-only machine surface's wire shapes (O-009; `docs/architecture.md`
// §7; the draft machine-surfaces contract, tools #12).
//
// THREE TOOLS THIS SLICE, ALL READS: `list_open_fixes`, `get_fix`,
// `get_finding`. The descriptors that bind these shapes to their names live in
// `./tools.ts`; the HTTP/stdio route that serves them is a later slice, and the
// fix spec's PROSE — structured state rendered to plain sentences under fixed
// headings — belongs to `packages/core`, not here. See `fixSpecEnvelopeSchema`
// below for why this file carries the rendered spec as one opaque string and
// declares none of its sections.
//
// WHY `packages/shared`. It depends on `zod` ONLY (never `@growthmind/core`,
// never `@growthmind/db`), and both the producer (a route in `apps/web`) and
// any consumer will already depend on it — the same reasoning that put the
// SummaryRenderer port's shapes in `../summary/types.ts`.
//
// ---------------------------------------------------------------------------
// TWO NAMING DECISIONS, BOTH DELIBERATE
// ---------------------------------------------------------------------------
//
// 1. TOOL NAMES ARE snake_case (`list_open_fixes`) and are quoted verbatim in
//    O-009's definition of done and in the draft contract. They are the wire,
//    so they are pinned as constants and asserted in `__tests__/mcp/tools.test.ts`
//    — the D9 hazard `worker/src/task-names.ts` documents at length. A renamed
//    tool is not a compile error anywhere; it is a capability that silently
//    stops being reachable, because a client asks for tools by string.
//
// 2. FIELD NAMES ARE camelCase, and this is a considered DEVIATION from the
//    draft contract's `fix_id` / `finding_id` prose. Every Zod schema in this
//    package is camelCase (`totalInWindow`, `resolvedModelId`,
//    `surfaceNormalisationVersion`), and one convention per repository beats
//    matching a draft's incidental key style. What the contract actually
//    requires is that EVERY response carries both ids — an agent working across
//    turns loses the thread otherwise, and a fix applied to the wrong finding
//    is worse than no fix. That requirement is met literally: `fixId` and
//    `findingId` are required on every output shape below, and a named test
//    pins it. Field style is cosmetic; carrying both ids is not.
//
// ---------------------------------------------------------------------------
// THE ORG IS NEVER AN ARGUMENT
// ---------------------------------------------------------------------------
//
// No input schema in this file has an organization key, and none may grow one.
// The organization comes from the authenticated credential the call arrived on
// and from nowhere else, so "give me another tenant's fixes" is not a sentence
// this contract can express — the D7 lesson
// `packages/db/__tests__/repositories/no-org-param.test.ts` already pays for at
// the repository and service layers, restated at the layer a customer's coding
// agent can actually reach. `__tests__/mcp/tools.test.ts` walks every input
// schema's keys recursively and fails on one.
//
// The client-supplied ids below (`fixId`, `findingId`, `projectId`) are the
// residual risk, and the schema cannot close it: an id is just a string.
// INHERITED OBLIGATION for whoever writes the route — every id must be
// resolved INSIDE the credential's organization, and an id belonging to
// another organization must answer exactly as an id that does not exist does.
// A distinguishable "not yours" answer is itself a cross-tenant read. There is
// no code here to test that against yet; it is a requirement handed forward,
// not a guarantee already met.

/**
 * An id as it actually exists in this product: `packages/db`'s primary keys are
 * `text` columns, not `uuid` (`packages/db/src/schema/finding-signatures.ts`),
 * so pinning this to `z.uuid()` would reject real ids. Bounded so a caller
 * cannot push an arbitrarily long string through an id-shaped hole.
 */
export const mcpIdSchema = z.string().min(1).max(128);

/**
 * A moment on the wire: an ISO-8601 UTC timestamp string, never a `Date`.
 * `z.iso.datetime()` rejects a numeric offset by default, so every timestamp
 * this surface emits is Z-normalised and two agents in two timezones read the
 * same instant.
 */
export const mcpTimestampSchema = z.iso.datetime();

// ---------------------------------------------------------------------------
// Counts, on the wire
// ---------------------------------------------------------------------------

/**
 * One row of a denominator's composition — the wire mirror of `SetAsideBasis`
 * in `packages/core/src/counts/measured-count.ts`, field for field.
 */
export const mcpSetAsideBasisSchema = z.object({
  reason: exclusionReasonSchema,
  count: z.number().int().nonnegative(),
  /** From `EXCLUSION_REASON_LABELS`, so the agent's own summary back to a
   * person is already in the right register. */
  label: z.string().min(1),
});
export type McpSetAsideBasis = z.infer<typeof mcpSetAsideBasisSchema>;

/** The wire mirror of `CountBasis`. `kept` IS the denominator. */
export const mcpCountBasisSchema = z.object({
  /** Every session selected into the window, kept or set aside. */
  totalInWindow: z.number().int().nonnegative(),
  /** The denominator: the sessions that had the opportunity to do the thing. */
  kept: z.number().int().nonnegative(),
  setAside: z.array(mcpSetAsideBasisSchema).readonly(),
});
export type McpCountBasis = z.infer<typeof mcpCountBasisSchema>;

/**
 * A count that cannot travel without its denominator — the WIRE FORM of
 * `MeasuredCount` (`packages/core/src/counts/measured-count.ts`, O-004 D-8,
 * FR-10). "3 sessions dropped off" is noise an agent cannot size; "3 of 28
 * sessions (12 set aside: 9 automated, 3 internal)" is a sentence it can put
 * in a pull request description.
 *
 * WHY A MIRROR RATHER THAN AN IMPORT. `packages/shared` may not depend on
 * `packages/core`, and the brand could not cross a JSON boundary even if it
 * could: `MeasuredCount` carries a module-private `unique symbol` that exists
 * to make the value unconstructible outside its own constructor, and
 * `JSON.stringify` drops symbol keys. So the wire form is structural by
 * necessity — which means the compile-time guarantee is gone and every
 * invariant has to be re-stated as a runtime check. All three of core's are,
 * below, in core's own words:
 *   - `kept + Σ setAside.count === totalInWindow` (D-7: the basis accounts for
 *     every session in the window);
 *   - `denominator === basis.kept` (FR-7: a count may never quote a
 *     denominator its own basis does not account for);
 *   - `numerator <= denominator` (the arithmetic identity: every count here is
 *     a SUBSET count, so "35 of 28" is a broken claim, not a large rate).
 *
 * A count core would refuse is therefore a count this surface refuses too, and
 * the mapping between the two is field-for-field with no renaming, so a drift
 * is visible by reading them side by side.
 *
 * `unit` is the literal `"sessions"` and never `"people"` (BS-3). Identity
 * stitching does not exist in this product, so "3 of 40" means 3 of 40
 * SESSIONS, and an agent must not be able to tell a founder otherwise.
 *
 * ZERO IS A VALID COUNT, NOT AN ERROR. `denominator = 0` (everything in the
 * window was set aside, ES-7) parses and must be reported as the sentence it
 * is. Nothing here divides, so there is no rate to go `NaN`.
 *
 * FAIL DIRECTION: refuse. A malformed count is a producer bug, and a count is
 * the thing an agent sizes its work by.
 */
export const mcpMeasuredCountSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    unit: z.literal("sessions"),
    timeframe: z.object({ start: mcpTimestampSchema, end: mcpTimestampSchema }),
    basis: mcpCountBasisSchema,
  })
  .superRefine((value, ctx) => {
    const setAsideTotal = value.basis.setAside.reduce((sum, row) => sum + row.count, 0);
    if (value.basis.kept + setAsideTotal !== value.basis.totalInWindow) {
      ctx.addIssue({
        code: "custom",
        path: ["basis"],
        message: `a basis must account for every session in the window: kept (${String(value.basis.kept)}) + set aside (${String(setAsideTotal)}) is not totalInWindow (${String(value.basis.totalInWindow)})`,
      });
    }

    if (value.denominator !== value.basis.kept) {
      ctx.addIssue({
        code: "custom",
        path: ["denominator"],
        message: `a denominator must be the basis's kept sessions: ${String(value.denominator)} is not ${String(value.basis.kept)}`,
      });
    }

    if (value.numerator > value.denominator) {
      ctx.addIssue({
        code: "custom",
        path: ["numerator"],
        message: `a numerator may never exceed its denominator: ${String(value.numerator)} of ${String(value.denominator)} is not a subset of the sessions measured`,
      });
    }

    if (Date.parse(value.timeframe.end) < Date.parse(value.timeframe.start)) {
      ctx.addIssue({
        code: "custom",
        path: ["timeframe"],
        message: "a timeframe must end no earlier than it starts",
      });
    }
  });
export type McpMeasuredCount = z.infer<typeof mcpMeasuredCountSchema>;

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * THE HARD CEILING on `list_open_fixes`, applied to the request AND to the
 * response array, so a server that ignores the request cannot emit a longer
 * list than the contract allows.
 *
 * An unbounded list tool is how a coding agent pulls an organization's whole
 * history into its context by accident: it calls the obvious first tool, gets
 * every fix ever opened, and spends the customer's tokens on rows it will never
 * read. That is a cost incident with no error message.
 *
 * WHY 25, specifically:
 *   - CONTEXT BUDGET. A summary row here is roughly 150 tokens once its
 *     denominator-bearing count is included. 25 rows is about 4k tokens — a
 *     couple of percent of the window a coding agent is sharing with the
 *     customer's own codebase. At 250 rows it is a fifth of that window, spent
 *     on navigation.
 *   - THE PRODUCT ALREADY WORKS THIS WAY. Findings reach a founder one at a
 *     time in Slack, and experiments are concurrency-capped per organization
 *     (`docs/architecture.md` §4.9). An organization with more than 25 open
 *     fixes has a prioritisation problem, and a longer list does not solve it.
 *   - IT IS ALSO THE DEFAULT (see `LIST_OPEN_FIXES_DEFAULT_ITEMS`), so the
 *     zero-argument call every agent makes first is already bounded, and the
 *     only thing `limit` can do is ask for FEWER.
 *
 * NO CURSOR, DELIBERATELY. Pagination would hand back exactly the "walk the
 * whole history" capability this ceiling exists to remove. When the list is cut
 * short, `listWindowSchema` says so out loud instead.
 */
export const LIST_OPEN_FIXES_MAX_ITEMS = 25;

/**
 * The default is the maximum. An agent that passes no arguments gets the most
 * urgent 25, never "all of them", and never has to know a ceiling exists.
 */
export const LIST_OPEN_FIXES_DEFAULT_ITEMS = LIST_OPEN_FIXES_MAX_ITEMS;

/**
 * The most evidence items one finding may carry on the wire. Same argument as
 * the list ceiling, one level down: an agent needs a handful of examples it can
 * open, not the corpus. Ten recordings is already more than anyone watches, and
 * `get_finding`'s count fields — not its evidence array — are what carry the
 * scale of the problem.
 */
export const FINDING_EVIDENCE_MAX_ITEMS = 10;

/**
 * Three attempts on one fix, then it is withdrawn (the draft contract's
 * ceiling, §13's token-budget rule). Stated on the envelope so an agent knows
 * how much rope it has BEFORE it starts, rather than discovering the ceiling by
 * hitting it — and so a re-dispatch can say "this is attempt 2 of 3".
 */
export const FIX_ATTEMPT_CEILING = 3;

// ---------------------------------------------------------------------------
// Closed unions
// ---------------------------------------------------------------------------

/**
 * Where a fix has got to. Total: no read on this surface may return `null` or
 * `undefined` to mean one of these four.
 */
export const fixStatusSchema = z.enum([
  /** Nobody has said they have done this yet. This is the only status that
   * means "there is work here for you". */
  "open",
  /** Someone's coding agent said it shipped, and nothing has confirmed that
   * yet. The claim-versus-fact distinction, in one value: what an agent says
   * about its own work never moves this to `verified` — only an independent
   * check of the code, the flag and the events does. */
  "awaiting_verification",
  /** The change is present, live, and firing the events it was meant to fire.
   * There is no work left here. */
  "verified",
  /** This one is closed and no longer accepts work — it either ran out of
   * attempts or ran out of time. Nothing further is needed from anyone. */
  "withdrawn",
]);
export type FixStatus = z.infer<typeof fixStatusSchema>;

/**
 * What kind of raw thing a piece of evidence points at. Every finding must be
 * able to show its work: a session, a count, a timeframe, and one click to the
 * thing itself — the replay, the failed request, the funnel step.
 */
export const findingEvidenceKindSchema = z.enum([
  /** A masked recording of one session where this happened. */
  "session_replay",
  /** A request the product made, or failed to make, during that session. */
  "network_request",
  /** One step of a funnel, with how many people reached it and how many got
   * past it. */
  "funnel_step",
  /** One event that fired, or stopped firing, tied to the line of code that
   * fires it. */
  "event",
]);
export type FindingEvidenceKind = z.infer<typeof findingEvidenceKindSchema>;

// ---------------------------------------------------------------------------
// Tool inputs. NOT ONE OF THESE MAY NAME AN ORGANIZATION.
// ---------------------------------------------------------------------------

/**
 * `list_open_fixes` — the only tool an agent can call knowing nothing at all,
 * which is why both of its fields are optional.
 *
 * `projectId` narrows to one project. INHERITED OBLIGATION for the route: it
 * must be resolved inside the credential's organization, and a project id from
 * another organization must answer identically to an id that does not exist.
 * An absent `projectId` means "every project in this organization", never
 * "every project".
 */
export const listOpenFixesInputSchema = z.object({
  projectId: mcpIdSchema.optional(),
  /** Ask for fewer than the default. There is no way to ask for more: the
   * ceiling is on this field AND on the response array. */
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_OPEN_FIXES_MAX_ITEMS)
    .default(LIST_OPEN_FIXES_DEFAULT_ITEMS),
});
export type ListOpenFixesInput = z.infer<typeof listOpenFixesInputSchema>;

/** `get_fix` — one fix, by the id `list_open_fixes` handed over. */
export const getFixInputSchema = z.object({
  fixId: mcpIdSchema,
});
export type GetFixInput = z.infer<typeof getFixInputSchema>;

/** `get_finding` — one finding, by the id every other response carries. */
export const getFindingInputSchema = z.object({
  findingId: mcpIdSchema,
});
export type GetFindingInput = z.infer<typeof getFindingInputSchema>;

// ---------------------------------------------------------------------------
// Tool outputs
// ---------------------------------------------------------------------------

/**
 * How much of the list you are looking at — the list's own denominator.
 *
 * DELIBERATELY NOT A `McpMeasuredCount`: that shape's `unit` is the literal
 * `"sessions"` and this counts FIXES. Widening `unit` so one shape could carry
 * both is precisely how a session count ends up rendered as a people count
 * (BS-3), so there are two shapes on purpose and the narrower one keeps its
 * literal.
 *
 * FAIL DIRECTION for the agent reading it: `truncated` exists so "I have seen
 * everything" is never an inference from a short array. It is `true` exactly
 * when `returned < totalOpen`, asserted rather than trusted — a producer that
 * cuts the list and forgets the flag would leave an agent confidently wrong
 * about the size of the work.
 */
export const listWindowSchema = z
  .object({
    /** How many entries are in this response. */
    returned: z.number().int().nonnegative().max(LIST_OPEN_FIXES_MAX_ITEMS),
    /** How many open fixes there are in total, in scope of this call. */
    totalOpen: z.number().int().nonnegative(),
    /** `true` when there are more open fixes than this response carries. */
    truncated: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.returned > value.totalOpen) {
      ctx.addIssue({
        code: "custom",
        path: ["returned"],
        message: `a response may not carry more entries than exist: ${String(value.returned)} of ${String(value.totalOpen)}`,
      });
    }

    if (value.truncated !== value.returned < value.totalOpen) {
      ctx.addIssue({
        code: "custom",
        path: ["truncated"],
        message: `truncated must state whether the list was cut short: ${String(value.returned)} of ${String(value.totalOpen)} returned, truncated was ${String(value.truncated)}`,
      });
    }
  });
export type ListWindow = z.infer<typeof listWindowSchema>;

/**
 * One row of `list_open_fixes`: enough to choose what to work on, and not one
 * field more. Everything else is behind `get_fix`.
 *
 * `status` is the LITERAL `"open"`. A fix awaiting verification is not open
 * work — returning one here would invite an agent to redo something that has
 * already landed — and a withdrawn one is closed. So "this list contains only
 * open fixes" is a property of the shape rather than of the query that filled
 * it: a producer that forgets its `WHERE` clause fails to parse rather than
 * quietly handing back work nobody wants done.
 */
export const openFixSummarySchema = z.object({
  fixId: mcpIdSchema,
  /** Every response carries both ids, so an agent working across turns cannot
   * lose which finding a fix belongs to. */
  findingId: mcpIdSchema,
  /** One sentence about what is wrong, in plain English. */
  summary: z.string().min(1),
  /** How many sessions this affected, out of how many were measured. */
  impact: mcpMeasuredCountSchema,
  openedAt: mcpTimestampSchema,
  /** The date this fix's result is due. It does not move. */
  resultsBy: mcpTimestampSchema,
  status: z.literal("open"),
});
export type OpenFixSummary = z.infer<typeof openFixSummarySchema>;

/**
 * `list_open_fixes` output. Ordering is part of the contract and is the
 * route's to honour: soonest `resultsBy` first, so a truncated list is the
 * most urgent slice rather than an arbitrary one.
 *
 * AN EMPTY LIST IS A WELL-FORMED ANSWER, NOT AN ERROR — `{ fixes: [], window:
 * { returned: 0, totalOpen: 0, truncated: false } }` parses, and it is the
 * first thing a brand-new installation returns.
 */
export const listOpenFixesOutputSchema = z
  .object({
    fixes: z.array(openFixSummarySchema).max(LIST_OPEN_FIXES_MAX_ITEMS).readonly(),
    window: listWindowSchema,
  })
  .superRefine((value, ctx) => {
    if (value.fixes.length !== value.window.returned) {
      ctx.addIssue({
        code: "custom",
        path: ["window", "returned"],
        message: `returned must count the entries actually sent: ${String(value.window.returned)} stated, ${String(value.fixes.length)} present`,
      });
    }
  });
export type ListOpenFixesOutput = z.infer<typeof listOpenFixesOutputSchema>;

/**
 * `get_fix` output — the ENVELOPE around a fix spec, not the spec itself.
 *
 * THE BOUNDARY, STATED. The fix spec is plain sentences under fixed headings
 * (Change / Why / Done means all three / Stop early if / Results by), rendered
 * from structured state by a pure function in `packages/core`. That renderer is
 * the single producer of those sentences. If this file also declared the
 * spec's sections, there would be two shapes describing one artefact and a
 * schema change in one of them would silently stop matching the other — the
 * dual-producer failure, with a customer's coding agent reading the losing
 * copy. So `specText` is carried as ONE opaque string, and the only structure
 * this envelope adds is the structure the renderer does not own: which attempt
 * this is, what already landed, and where it sits.
 *
 * `resultsBy` appears both here and inside `specText`. That is deliberate
 * duplication of ONE persisted value, not two producers: the machine-readable
 * copy is for the agent's planning and the sentence is what it reads. The
 * immutability rule lives with the sentence, and `dateIsFinal` restates it
 * where a machine will see it.
 *
 * THE SEAM, NAMED. `renderFixSpec` in `packages/core/src/fixes/fix-spec.ts`
 * produces a SECTIONED `FixSpec` (`symptom`, `evidence`, `measurement`,
 * `boundary`, and `sentences` — every section in reading order), and its own
 * comment calls that "the shape that crosses the MCP wire". This envelope
 * carries `specText`, one string, because `packages/shared` may not depend on
 * `packages/core` — embedding the sectioned shape here is not available, and
 * restating it would be the drift this boundary exists to prevent. The join is
 * one line and belongs to whoever writes the route:
 * `specText: spec.sentences.join("\n")`. If a later slice decides an agent
 * should receive the sections rather than the joined text, the descriptor for
 * `get_fix` moves to a package that may import `core` (`packages/mcp`) and
 * composes `fixSpecSchema` directly — which is a deliberate decision to take
 * there, not a field to widen here.
 */
export const fixSpecEnvelopeSchema = z
  .object({
    fixId: mcpIdSchema,
    findingId: mcpIdSchema,
    status: fixStatusSchema,
    /**
     * The spec itself: plain sentences under fixed headings. It NEVER contains
     * code — no diffs, no snippets, no file contents. Growthmind describes the
     * change and names the files; the agent reading this knows the codebase
     * better than the specification does.
     */
    specText: z.string().min(1),
    /** Which attempt this is, counting from 1. */
    attempt: z.number().int().min(1).max(FIX_ATTEMPT_CEILING),
    /** How many attempts there are in total, stated up front. */
    attemptsAllowed: z.literal(FIX_ATTEMPT_CEILING),
    /**
     * What earlier attempts already got done, one plain sentence each. Empty on
     * attempt 1. A re-dispatch narrows to the gap and never repeats the whole
     * specification, and this array is how the agent knows which part is
     * already behind it.
     */
    alreadyLanded: z.array(z.string().min(1)).max(FIX_ATTEMPT_CEILING).readonly(),
    /** How many sessions the underlying problem affected, out of how many were
     * measured — the size of the prize, carried on the envelope so an agent
     * does not have to call `get_finding` to size the work. */
    impact: mcpMeasuredCountSchema,
    /** The date the result is due. */
    resultsBy: mcpTimestampSchema,
    /** Always `true`: the date above does not move, and saying so where a
     * machine can read it is cheaper than hoping the sentence is noticed. */
    dateIsFinal: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (value.attempt === 1 && value.alreadyLanded.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["alreadyLanded"],
        message: "a first attempt cannot have earlier work to narrow around",
      });
    }
  });
export type FixSpecEnvelope = z.infer<typeof fixSpecEnvelopeSchema>;

/** One piece of evidence: the raw thing, and one sentence saying what it is. */
export const findingEvidenceSchema = z.object({
  kind: findingEvidenceKindSchema,
  /** What this shows, in plain English. */
  label: z.string().min(1),
  /** Where to open it. `null` when the raw thing is not linkable — a funnel
   * step is a number, not a page — and never a placeholder link. */
  url: z.url().nullable(),
});
export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;

/**
 * `get_finding` output — what happened, how many sessions ran into it, over
 * what dates, and the raw things that show it.
 *
 * `evidence` REQUIRES AT LEAST ONE ITEM. A finding with nothing behind it is
 * not a finding this product is willing to state: unevidenced claims burn trust
 * faster than silence, and a coding agent is about to spend a customer's tokens
 * on whatever this says. FAIL DIRECTION: refuse to serve it rather than serve a
 * claim with no way to check it.
 *
 * `surface.path` is `null` when the taxonomy cannot resolve this surface to a
 * file. `null` is the honest value and must stay distinguishable from a guess —
 * an agent given a wrong path edits the wrong file with complete confidence.
 *
 * NO FINDING-CLASS FIELD. `packages/core` owns that union and this package may
 * not import it; restating it here would create a second vocabulary that drifts
 * from the first. The headline says what happened in words instead, which is
 * what an agent needs and what a person reading over its shoulder needs.
 */
export const getFindingOutputSchema = z.object({
  findingId: mcpIdSchema,
  /** `null` when nobody has asked for this to be fixed yet. Both ids travel on
   * every response; this one is nullable because the fix may not exist, never
   * because it was inconvenient to look up. */
  fixId: mcpIdSchema.nullable(),
  /** One sentence: what happened. */
  headline: z.string().min(1),
  /** A short paragraph: what we saw, and what we are not claiming. */
  detail: z.string().min(1),
  surface: z.object({
    /** What a person calls this place: "the invite screen". */
    name: z.string().min(1),
    /** The file it resolves to, or `null` when it does not resolve. */
    path: z.string().min(1).nullable(),
  }),
  /** How many sessions ran into this, out of how many were measured. */
  affected: mcpMeasuredCountSchema,
  firstSeenAt: mcpTimestampSchema,
  lastSeenAt: mcpTimestampSchema,
  evidence: z.array(findingEvidenceSchema).min(1).max(FINDING_EVIDENCE_MAX_ITEMS).readonly(),
});
export type GetFindingOutput = z.infer<typeof getFindingOutputSchema>;
