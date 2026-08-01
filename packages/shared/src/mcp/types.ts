import { z } from "zod";

import { exclusionReasonSchema } from "../exclusions/types";

// Wire shapes for the read-only machine surface: three tools, all reads, with the
// descriptors that bind them to their names in `./tools.ts`. No input schema in this
// file has an organization key and none may grow one: the organization comes from the
// authenticated credential the call arrived on, and from nowhere else.
// Design rationale: docs/decisions/0008-mcp-tool-types.md

/**
 * An id as it actually exists in this product: `packages/db`'s primary keys are `text`
 * columns, not `uuid` (`packages/db/src/schema/finding-signatures.ts`), so pinning this
 * to `z.uuid` would reject real ids. Bounded so a caller cannot push an arbitrarily
 * long string through an id-shaped hole.
 */
export const mcpIdSchema = z.string().min(1).max(128);

/**
 * A moment on the wire: an ISO-8601 UTC timestamp string, never a `Date`.
 * `z.iso.datetime` rejects a numeric offset by default, so every timestamp this
 * surface emits is Z-normalised and two agents in two timezones read the same instant.
 */
export const mcpTimestampSchema = z.iso.datetime();

// Counts, on the wire

/**
 * One row of a denominator's composition. The wire mirror of `SetAsideBasis` in
 * `packages/core/src/counts/measured-count.ts`, field for field.
 */
export const mcpSetAsideBasisSchema = z.object({
  reason: exclusionReasonSchema,
  count: z.number().int().nonnegative(),
  /** From `EXCLUSION_REASON_LABELS`, so the agent's own summary back to a person is
   * already in the right register. */
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
 * A count that cannot travel without its denominator. The wire form of `MeasuredCount`
 * (`packages/core/src/counts/measured-count.ts`). "3 sessions dropped off" is noise
 * an agent cannot size; "3 of 28 sessions (12 set aside: 9 automated, 3 internal)" is a
 * sentence it can put in a pull request description.
 *
 * Why a mirror rather than an import. `packages/shared` may not depend on
 * `packages/core`, and the brand could not cross a JSON boundary even if it could:
 * `MeasuredCount` carries a module-private `unique symbol` that exists to make the
 * value unconstructible outside its own constructor, and `JSON.stringify` drops symbol
 * keys. So the wire form is structural by necessity, which means the compile-time
 * guarantee is gone and every invariant has to be re-stated as a runtime check. All
 * three of core's are, below, in core's own words:
 * `kept + Σ setAside.count === totalInWindow` (the basis accounts for
 *  every session in the window);
 * `denominator === basis.kept` (a count may never quote a
 *  denominator its own basis does not account for);
 * `numerator <= denominator` (the arithmetic identity: every count here is
 *  a subset count, so "35 of 28" is a broken claim, not a large rate).
 *
 * A count core would refuse is therefore a count this surface refuses too, and the
 * mapping between the two is field-for-field with no renaming, so a drift is visible by
 * reading them side by side.
 *
 * `unit` is the literal `"sessions"` and never `"people"`. Identity stitching does not
 * exist in this product, so "3 of 40" means 3 of 40 sessions, and an agent must not be
 * able to tell a founder otherwise.
 *
 * Zero is a valid count, not an error. `denominator = 0` (everything in the window was
 * set aside) parses and must be reported as the sentence it is. Nothing here
 * divides, so there is no rate to go `NaN`.
 *
 * Fail direction: refuse. A malformed count is a producer bug, and a count is the thing
 * an agent sizes its work by.
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

// Bounds

/**
 * The hard ceiling on `list_open_fixes`, applied to the request and to the response
 * array, so a server that ignores the request cannot emit a longer list than the
 * contract allows.
 *
 * An unbounded list tool is how a coding agent pulls an organization's whole history
 * into its context by accident: it calls the obvious first tool, gets every fix ever
 * opened, and spends the customer's tokens on rows it will never read. That is a cost
 * incident with no error message.
 *
 * Why 25, specifically:
 * Context budget. A summary row here is roughly 150 tokens once its
 *  denominator-bearing count is included. 25 rows is about 4k tokens — a
 *  couple of percent of the window a coding agent is sharing with the
 *  customer's own codebase. At 250 rows it is a fifth of that window, spent
 *  on navigation.
 * The product already works this way. Findings reach a founder one at a
 *  time in Slack, and experiments are concurrency-capped per organization
 *  (`docs/architecture.md`). An organization with more than 25 open
 *  fixes has a prioritisation problem, and a longer list does not solve it.
 * It is also the default (see `LIST_OPEN_FIXES_DEFAULT_ITEMS`), so the
 *  zero-argument call every agent makes first is already bounded, and the
 *  only thing `limit` can do is ask for fewer.
 *
 * No cursor, deliberately. Pagination would hand back exactly the "walk the whole
 * history" capability this ceiling exists to remove. When the list is cut short,
 * `listWindowSchema` says so out loud instead.
 */
export const LIST_OPEN_FIXES_MAX_ITEMS = 25;

/**
 * The default is the maximum. An agent that passes no arguments gets the most urgent
 * 25, never "all of them", and never has to know a ceiling exists.
 */
export const LIST_OPEN_FIXES_DEFAULT_ITEMS = LIST_OPEN_FIXES_MAX_ITEMS;

/**
 * The most evidence items one finding may carry on the wire. Same argument as the list
 * ceiling, one level down: an agent needs a handful of examples it can open, not the
 * corpus. Ten recordings is already more than anyone watches, and `get_finding`'s count
 * fields (not its evidence array) are what carry the scale of the problem.
 */
export const FINDING_EVIDENCE_MAX_ITEMS = 10;

/**
 * Three attempts on one fix, then it is withdrawn (the draft contract's ceiling, the
 * token-budget rule). Stated on the envelope so an agent knows how much rope it has
 * before it starts, rather than discovering the ceiling by hitting it, and so a
 * re-dispatch can say "this is attempt 2 of 3".
 */
export const FIX_ATTEMPT_CEILING = 3;

// Closed unions

/**
 * Where a fix has got to. Total: no read on this surface may return `null` or
 * `undefined` to mean one of these four.
 */
export const fixStatusSchema = z.enum([
  /** Nobody has said they have done this yet. This is the only status that means "there
   * is work here for you". */
  "open",
  /** Someone's coding agent said it shipped, and nothing has confirmed that yet. The
   * claim-versus-fact distinction, in one value: what an agent says about its own work
   * never moves this to `verified`. Only an independent check of the code, the flag and
   * the events does. */
  "awaiting_verification",
  /** The change is present, live, and firing the events it was meant to fire. There is
   * no work left here. */
  "verified",
  /** This one is closed and no longer accepts work. It either ran out of attempts or
   * ran out of time. Nothing further is needed from anyone. */
  "withdrawn",
]);
export type FixStatus = z.infer<typeof fixStatusSchema>;

/**
 * What kind of raw thing a piece of evidence points at. Every finding must be able to
 * show its work: a session, a count, a timeframe, and one click to the thing itself.
 * The replay, the failed request, the funnel step.
 */
export const findingEvidenceKindSchema = z.enum([
  /** A masked recording of one session where this happened. */
  "session_replay",
  /** A request the product made, or failed to make, during that session. */
  "network_request",
  /** One step of a funnel, with how many people reached it and how many got past it. */
  "funnel_step",
  /** One event that fired, or stopped firing, tied to the line of code that fires it. */
  "event",
]);
export type FindingEvidenceKind = z.infer<typeof findingEvidenceKindSchema>;

// Tool inputs. Not one of these may name an organization.

/**
 * `list_open_fixes`, the only tool an agent can call knowing nothing at all, which is
 * why both of its fields are optional.
 *
 * `projectId` narrows to one project. Inherited obligation for the route: it must be
 * resolved inside the credential's organization, and a project id from another
 * organization must answer identically to an id that does not exist. An absent
 * `projectId` means "every project in this organization", never "every project".
 */
export const listOpenFixesInputSchema = z.object({
  projectId: mcpIdSchema.optional(),
  /** Ask for fewer than the default. There is no way to ask for more: the ceiling is on
   * this field and on the response array. */
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_OPEN_FIXES_MAX_ITEMS)
    .default(LIST_OPEN_FIXES_DEFAULT_ITEMS),
});
export type ListOpenFixesInput = z.infer<typeof listOpenFixesInputSchema>;

/** `get_fix`, one fix, by the id `list_open_fixes` handed over. */
export const getFixInputSchema = z.object({
  fixId: mcpIdSchema,
});
export type GetFixInput = z.infer<typeof getFixInputSchema>;

/** `get_finding`, one finding, by the id every other response carries. */
export const getFindingInputSchema = z.object({
  findingId: mcpIdSchema,
});
export type GetFindingInput = z.infer<typeof getFindingInputSchema>;

// Tool outputs

/**
 * How much of the list you are looking at. The list's own denominator.
 *
 * Deliberately not a `McpMeasuredCount`: that shape's `unit` is the literal
 * `"sessions"` and this counts fixes. Widening `unit` so one shape could carry both is
 * precisely how a session count ends up rendered as a people count, so there are two
 * shapes on purpose and the narrower one keeps its literal.
 *
 * Fail direction for the agent reading it: `truncated` exists so "I have seen
 * everything" is never an inference from a short array. It is `true` exactly when
 * `returned < totalOpen`, asserted rather than trusted. A producer that cuts the list
 * and forgets the flag would leave an agent confidently wrong about the size of the
 * work.
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
 * One row of `list_open_fixes`: enough to choose what to work on, and not one field
 * more. Everything else is behind `get_fix`.
 *
 * `status` is the literal `"open"`. A fix awaiting verification is not open work.
 * Returning one here would invite an agent to redo something that has already landed,
 * and a withdrawn one is closed. So "this list contains only open fixes" is a property
 * of the shape rather than of the query that filled it: a producer that forgets its
 * `WHERE` clause fails to parse rather than quietly handing back work nobody wants
 * done.
 */
export const openFixSummarySchema = z.object({
  fixId: mcpIdSchema,
  /** Every response carries both ids, so an agent working across turns cannot lose
   * which finding a fix belongs to. */
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
 * `list_open_fixes` output. Ordering is part of the contract and is the route's to
 * honour: soonest `resultsBy` first, so a truncated list is the most urgent slice
 * rather than an arbitrary one.
 *
 * An empty list is a well-formed answer, not an error, `{ fixes: [], window: {
 * returned: 0, totalOpen: 0, truncated: false } }` parses, and it is the first thing a
 * brand-new installation returns.
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
 * `get_fix` output, the envelope around a fix spec, not the spec itself.
 *
 * The boundary, stated. The fix spec is plain sentences under fixed headings (Change /
 * Why / Done means all three / Stop early if / Results by), rendered from structured
 * state by a pure function in `packages/core`. That renderer is the single producer of
 * those sentences. If this file also declared the spec's sections, there would be two
 * shapes describing one artefact and a schema change in one of them would silently stop
 * matching the other. The dual-producer failure, with a customer's coding agent reading
 * the losing copy. So `specText` is carried as one opaque string, and the only
 * structure this envelope adds is the structure the renderer does not own: which
 * attempt this is, what already landed, and where it sits.
 *
 * `resultsBy` appears both here and inside `specText`. That is deliberate duplication
 * of one persisted value, not two producers: the machine-readable copy is for the
 * agent's planning and the sentence is what it reads. The immutability rule lives with
 * the sentence, and `dateIsFinal` restates it where a machine will see it.
 *
 * The seam, named. `renderFixSpec` in `packages/core/src/fixes/fix-spec.ts` produces a
 * sectioned `FixSpec` (`symptom`, `evidence`, `measurement`, `boundary`, and
 * `sentences`. Every section in reading order), and its own comment calls that "the
 * shape that crosses the MCP wire". This envelope carries `specText`, one string,
 * because `packages/shared` may not depend on `packages/core`. Embedding the sectioned
 * shape here is not available, and restating it would be the drift this boundary exists
 * to prevent. The join is one line and belongs to whoever writes the route: `specText:
 * spec.sentences.join`. If a later slice decides an agent should receive the
 * sections rather than the joined text, the descriptor for `get_fix` moves to a package
 * that may import `core` (`packages/mcp`) and composes `fixSpecSchema` directly, which
 * is a deliberate decision to take there, not a field to widen here.
 */
export const fixSpecEnvelopeSchema = z
  .object({
    fixId: mcpIdSchema,
    findingId: mcpIdSchema,
    status: fixStatusSchema,
    /**
     * The spec itself: plain sentences under fixed headings. It never contains code. No
     * diffs, no snippets, no file contents. Growthmind describes the change and names
     * the files; the agent reading this knows the codebase better than the
     * specification does.
     */
    specText: z.string().min(1),
    /** Which attempt this is, counting from 1. */
    attempt: z.number().int().min(1).max(FIX_ATTEMPT_CEILING),
    /** How many attempts there are in total, stated up front. */
    attemptsAllowed: z.literal(FIX_ATTEMPT_CEILING),
    /**
     * What earlier attempts already got done, one plain sentence each. Empty on attempt
     * 1. A re-dispatch narrows to the gap and never repeats the whole specification,
     * and this array is how the agent knows which part is already behind it.
     */
    alreadyLanded: z.array(z.string().min(1)).max(FIX_ATTEMPT_CEILING).readonly(),
    /** How many sessions the underlying problem affected, out of how many were
     * measured. The size of the prize, carried on the envelope so an agent does not
     * have to call `get_finding` to size the work. */
    impact: mcpMeasuredCountSchema,
    /** The date the result is due. */
    resultsBy: mcpTimestampSchema,
    /** Always `true`: the date above does not move, and saying so where a machine can
     * read it is cheaper than hoping the sentence is noticed. */
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
  /** Where to open it. `null` when the raw thing is not linkable (a funnel step is a
   * number, not a page) and never a placeholder link. */
  url: z.url().nullable(),
});
export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;

/**
 * `get_finding` output, what happened, how many sessions ran into it, over what dates,
 * and the raw things that show it.
 *
 * `evidence` requires at least one item. A finding with nothing behind it is not a
 * finding this product is willing to state: unevidenced claims burn trust faster than
 * silence, and a coding agent is about to spend a customer's tokens on whatever this
 * says. Fail direction: refuse to serve it rather than serve a claim with no way to
 * check it.
 *
 * `surface.path` is `null` when the taxonomy cannot resolve this surface to a file.
 * `null` is the honest value and must stay distinguishable from a guess. An agent given
 * a wrong path edits the wrong file with complete confidence.
 *
 * No finding-class field. `packages/core` owns that union and this package may not
 * import it; restating it here would create a second vocabulary that drifts from the
 * first. The headline says what happened in words instead, which is what an agent needs
 * and what a person reading over its shoulder needs.
 */
export const getFindingOutputSchema = z.object({
  findingId: mcpIdSchema,
  /** `null` when nobody has asked for this to be fixed yet. Both ids travel on every
   * response; this one is nullable because the fix may not exist, never because it was
   * inconvenient to look up. */
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
