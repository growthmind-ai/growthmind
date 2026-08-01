// The shapes every T1 detector reads and writes.
//
// `packages/db` imports `DetectorCorpus` from here. The arrow is db -> core, never core
// -> db: nothing in this package imports `@growthmind/db`, and an ast test asserts it.
import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { z } from "zod";

import type { CountBasis, MeasuredCount } from "../counts/measured-count";
import type { EvidenceSignal } from "../evidence/signals";
import type { DetectorName, DetectorProposedClass } from "../rules/types";

/**
 * The corpus read's session cap.
 *
 * The corpus is capped by session and never mid-session: a half-loaded session
 * fabricates a drop-off, because the events proving the user reached the destination
 * are exactly the ones the cap dropped. Capping by session makes every loaded session
 * complete by construction, and `DetectorCoverage.truncated` carries the limitation
 * onto every candidate rather than hiding it. The That decision was a silent truncation
 * that read as "no more events", and this is that fix applied before the incident
 * rather than after it.
 *
 * Not a member of `ThresholdRuleSet`: it is a read-side cost bound, not an assertion
 * gate, and mixing the two would put a cost threshold in a rule set whose every other
 * member is documented as under-detect.
 */
export const DETECTOR_CORPUS_MAX_SESSIONS = 500;

/**
 * One persisted event, as a detector sees it. These four columns plus the session
 * linkage are all that exists per event: `events` has no `properties` jsonb column,
 * deliberately, on privacy grounds.
 */
export type TimelineEvent = {
  /** The vendor's server-assigned id. The deterministic tie-break in `orderTimeline`.
   * Determinism is the contract; that it happens to be a UUIDv7 in this deployment is
   * an observation and must never be relied on. */
  readonly sourceEventId: string;
  readonly name: string;
  /** The vendor's client-declared event time. Not an arrival time. */
  readonly occurredAt: Date;
  /** Normalised and redacted by `normaliseUrlPath`, and genuinely nullable: an
   * event with no usable path is not an error. */
  readonly urlPath: string | null;
  /** Which normalisation rules produced `urlPath`. `null` means "written before
   * versions were recorded. Redaction status unknown", and is never coerced to `0`
   * . */
  readonly urlPathNormalisationVersion: number | null;
};

/**
 * One session and all of its events. The window anchors on `startedAt`; once a session
 * is selected, all of its events are analysed regardless of their own `occurredAt`.
 * Filtering events by the window cuts sessions at the boundary and reintroduces the
 * fabricated drop-off through a different door.
 */
export type SessionTimeline = {
  readonly sessionId: string;
  readonly startedAt: Date;
  /** Carried, not pre-filtered: the detector excludes non-`"none"` sessions from every
   * numerator, which is what makes that rule a property of the tested pure layer rather
   * than of an untested read. */
  readonly exclusionReason: ExclusionReason;
  readonly entryUrlPath: string | null;
  readonly events: readonly TimelineEvent[];
};

/** The analysis window. An injected parameter, never derived from a clock inside this
 * package. */
export type AnalysisWindow = {
  readonly start: Date;
  readonly end: Date;
};

export const analysisWindowSchema = z.object({
  start: z.date(),
  end: z.date(),
});

/**
 * What the run could not see, travelling beside what it did.
 *
 * No field here is named `count`, `total`, `sessions`, or `hits`: the ast test forbids
 * a bare `number` field with such a name on any exported detector or gate return type,
 * because a magnitude a customer reads belongs in a `MeasuredCount` with its
 * denominator. These two are coverage statements about the run, not claims about the
 * product.
 */
export type DetectorCoverage = {
  /** `true` when `DETECTOR_CORPUS_MAX_SESSIONS` bound the read. Travels onto every
   * candidate the run produces. */
  readonly truncated: boolean;
  /** Events excluded from path transitions because `urlPath` was `null`.
   * Excluded and reported, never silently dropped. */
  readonly eventsWithoutUrlPath: number;
};

export const detectorCoverageSchema = z.object({
  truncated: z.boolean(),
  eventsWithoutUrlPath: z.number().int().nonnegative(),
});

/**
 * The org-scoped, ordered, windowed corpus a detector runs over. The only thing
 * `packages/db` produces for this layer. SQL selects and orders; every count,
 * comparison, threshold, and class judgement is pure TypeScript here.
 *
 * `connectionState` is what makes (polled, and there is genuinely nothing)
 * distinguishable from (connected, never polled). An empty `sessions` array alone
 * cannot tell those apart, and they are different answers to the customer.
 */
export type DetectorCorpus = {
  readonly projectId: string;
  readonly window: AnalysisWindow;
  readonly connectionState: ConnectionState;
  /** Every session selected, kept and set-aside alike, each carrying its own
   * `exclusionReason`. */
  readonly sessions: readonly SessionTimeline[];
  /** The denominator and its composition. `basis.kept` is the denominator of every
   * count this corpus can support. */
  readonly basis: CountBasis;
  readonly coverage: DetectorCoverage;
};

/**
 * What `surface` is about. A one-member literal union, not a bare `string` and not a
 * comment: today every T1 detector's claim is about a `surface` (a normalised
 * `url_path`) and nothing else, and this type is what makes a future detector claiming
 * something else. A user segment, a feature flag, anything not a surface. A
 * compile-visible event rather than a silent overload of the same field. "Encode the
 * rule in the type, not in a reviewer's memory" (retro).
 *
 * Zod, not a comment: a one-member schema still buys the same widening protection a
 * `z.enum` would. Adding a second claim subject later means editing this schema, which
 * is the compile-visible event.
 */
export const claimSubjectSchema = z.literal("surface");
export type ClaimSubject = z.infer<typeof claimSubjectSchema>;

/**
 * What a T1 detector proposes. `claimedClass` is `DetectorProposedClass`, so the class
 * a detector may propose is constrained by type. The front door the cascade floor
 * cannot close on its own.
 */
export type DetectorCandidate = {
  readonly detector: DetectorName;
  readonly claimedClass: DetectorProposedClass;
  /** What `surface` below is a claim about. Every T1 detector this sprint claims a
   * surface; nothing here reads "surface" out of a comment anywhere else in this
   * package. */
  readonly claimSubject: ClaimSubject;
  /** The normalised `url_path` the claim is about. */
  readonly surface: string;
  /** `null` for a row written before versions were recorded. */
  readonly surfaceNormalisationVersion: number | null;
  readonly signals: readonly EvidenceSignal[];
  readonly counts: readonly MeasuredCount[];
  readonly timeframe: AnalysisWindow;
  /** The run's coverage travels onto every candidate. */
  readonly coverage: DetectorCoverage;
};

/**
 * A detector's whole output. An empty `candidates` array is a real answer,
 * `connectionState` and `coverage` are what stop it being confusable with "the detector
 * never ran".
 */
export type DetectorResult = {
  readonly detector: DetectorName;
  readonly connectionState: ConnectionState;
  readonly coverage: DetectorCoverage;
  readonly candidates: readonly DetectorCandidate[];
};
