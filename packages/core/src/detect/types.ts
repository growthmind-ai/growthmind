// The shapes every T1 detector reads and writes (O-004 D-2, D-3, D-4, D-5).
//
// `packages/db` imports `DetectorCorpus` from here. The arrow is db -> core,
// NEVER core -> db: nothing in this package imports `@growthmind/db`, and an
// AST test asserts it (FR-5).
import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { z } from "zod";

import type { CountBasis, MeasuredCount } from "../counts/measured-count";
import type { EvidenceSignal } from "../evidence/signals";
import type { DetectorName, DetectorProposedClass } from "../rules/types";

/**
 * The corpus read's session cap (D-3).
 *
 * The corpus is capped by SESSION and never mid-session: a half-loaded session
 * fabricates a drop-off, because the events proving the user reached the
 * destination are exactly the ones the cap dropped. Capping by session makes
 * every loaded session complete BY CONSTRUCTION, and `DetectorCoverage.truncated`
 * carries the limitation onto every candidate rather than hiding it — O-003's
 * CR-1 was a silent truncation that read as "no more events", and this is that
 * fix applied before the incident rather than after it.
 *
 * NOT a member of `ThresholdRuleSet`: it is a read-side cost bound, not an
 * assertion gate, and mixing the two would put a cost threshold in a rule set
 * whose every other member is documented as under-detect (D-14).
 */
export const DETECTOR_CORPUS_MAX_SESSIONS = 500;

/**
 * One persisted event, as a detector sees it. These four columns plus the
 * session linkage are ALL that exists per event (BS-1): `events` has no
 * `properties` jsonb column, deliberately, on privacy grounds.
 */
export type TimelineEvent = {
  /** The vendor's server-assigned id. The deterministic tie-break in `orderTimeline`
   * (D-5) — determinism is the contract; that it happens to be a UUIDv7 in
   * this deployment is an observation and must never be relied on. */
  readonly sourceEventId: string;
  readonly name: string;
  /** The vendor's CLIENT-DECLARED event time. Not an arrival time. */
  readonly occurredAt: Date;
  /** Normalised and redacted by `normaliseUrlPath`, and genuinely nullable
   * (BS-4, ES-4): an event with no usable path is not an error. */
  readonly urlPath: string | null;
  /** Which normalisation rules produced `urlPath` (D-15, FR-18). `null` means
   * "written before versions were recorded — redaction status unknown", and is
   * NEVER coerced to `0` (ES-14). */
  readonly urlPathNormalisationVersion: number | null;
};

/**
 * One session and all of its events (D-4). The window anchors on
 * `startedAt`; once a session is selected, ALL of its events are analysed
 * regardless of their own `occurredAt` — filtering events by the window cuts
 * sessions at the boundary and reintroduces D-3's fabricated drop-off through
 * a different door.
 */
export type SessionTimeline = {
  readonly sessionId: string;
  readonly startedAt: Date;
  /** Carried, not pre-filtered: the DETECTOR excludes non-`"none"` sessions
   * from every numerator (FR-7, D-7), which is what makes that rule a
   * property of the tested pure layer rather than of an untested read. */
  readonly exclusionReason: ExclusionReason;
  readonly entryUrlPath: string | null;
  readonly events: readonly TimelineEvent[];
};

/** The analysis window. An INJECTED parameter, never derived from a clock
 * inside this package (FR-5, FR-6). */
export type AnalysisWindow = {
  readonly start: Date;
  readonly end: Date;
};

export const analysisWindowSchema = z.object({
  start: z.date(),
  end: z.date(),
});

/**
 * What the run could not see, travelling beside what it did (D-3, ES-4).
 *
 * No field here is named `count`, `total`, `sessions`, or `hits`: the D-8 AST
 * test forbids a bare `number` field with such a name on any exported detector
 * or gate return type, because a magnitude a customer reads belongs in a
 * `MeasuredCount` with its denominator. These two are coverage statements
 * about the RUN, not claims about the product.
 */
export type DetectorCoverage = {
  /** `true` when `DETECTOR_CORPUS_MAX_SESSIONS` bound the read. Travels onto
   * EVERY candidate the run produces (D-3). */
  readonly truncated: boolean;
  /** Events excluded from path transitions because `urlPath` was `null`
   * (ES-4, BS-4). Excluded AND reported — never silently dropped. */
  readonly eventsWithoutUrlPath: number;
};

export const detectorCoverageSchema = z.object({
  truncated: z.boolean(),
  eventsWithoutUrlPath: z.number().int().nonnegative(),
});

/**
 * The org-scoped, ordered, windowed corpus a detector runs over — the ONLY
 * thing `packages/db` produces for this layer (D-2). SQL selects and orders;
 * every count, comparison, threshold, and class judgement is pure TypeScript
 * here.
 *
 * `connectionState` is what makes ES-1 (polled, and there is genuinely
 * nothing) distinguishable from ES-8 (connected, never polled). An empty
 * `sessions` array alone cannot tell those apart, and they are different
 * answers to the customer.
 */
export type DetectorCorpus = {
  readonly projectId: string;
  readonly window: AnalysisWindow;
  readonly connectionState: ConnectionState;
  /** Every session selected, kept and set-aside alike, each carrying its own
   * `exclusionReason`. */
  readonly sessions: readonly SessionTimeline[];
  /** The denominator and its composition (D-7). `basis.kept` is the
   * denominator of every count this corpus can support. */
  readonly basis: CountBasis;
  readonly coverage: DetectorCoverage;
};

/**
 * What `surface` is ABOUT (O-005 D-5, ESC-6). A one-member literal union,
 * not a bare `string` and not a comment: today every T1 detector's claim is
 * about a `surface` (a normalised `url_path`) and nothing else, and this type
 * is what makes a FUTURE detector claiming something else — a user segment,
 * a feature flag, anything not a surface — a COMPILE-VISIBLE event rather
 * than a silent overload of the same field. "Encode the rule in the type,
 * not in a reviewer's memory" (O-004 retro).
 *
 * Zod, not a comment (FR-3c): a one-member schema still buys the same
 * widening protection a `z.enum` would — adding a second claim subject
 * later means editing THIS schema, which is the compile-visible event.
 */
export const claimSubjectSchema = z.literal("surface");
export type ClaimSubject = z.infer<typeof claimSubjectSchema>;

/**
 * What a T1 detector proposes. `claimedClass` is `DetectorProposedClass`, so
 * the class a detector may propose is constrained BY TYPE (D-9) — the front
 * door FR-13B's cascade floor cannot close on its own.
 */
export type DetectorCandidate = {
  readonly detector: DetectorName;
  readonly claimedClass: DetectorProposedClass;
  /** What `surface` below is a claim ABOUT (D-5, ESC-6). Every T1 detector
   * this sprint claims a surface; nothing here reads "surface" out of a
   * comment anywhere else in this package. */
  readonly claimSubject: ClaimSubject;
  /** The normalised `url_path` the claim is about. */
  readonly surface: string;
  /** `null` for a row written before versions were recorded (ES-14). */
  readonly surfaceNormalisationVersion: number | null;
  readonly signals: readonly EvidenceSignal[];
  readonly counts: readonly MeasuredCount[];
  readonly timeframe: AnalysisWindow;
  /** D-3: the run's coverage travels onto EVERY candidate. */
  readonly coverage: DetectorCoverage;
};

/**
 * A detector's whole output. An empty `candidates` array is a real answer —
 * `connectionState` and `coverage` are what stop it being confusable with
 * "the detector never ran" (ES-1, ES-8).
 */
export type DetectorResult = {
  readonly detector: DetectorName;
  readonly connectionState: ConnectionState;
  readonly coverage: DetectorCoverage;
  readonly candidates: readonly DetectorCandidate[];
};
