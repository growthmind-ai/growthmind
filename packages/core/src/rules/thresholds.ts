// The versioned threshold rule sets (O-004 D-14, FR-8, FR-9, FR-11).
//
// Shape, comment style, and export trio are copied from
// `packages/shared/src/exclusions/classify.ts:19-40` — the closest working
// model in this repo, and the house pattern a reviewer already knows.
//
// EVERY detector and EVERY gate predicate takes a rule set as a PARAMETER.
// Nothing in this package reaches for `CURRENT_THRESHOLD_RULE_SET` internally
// (D-14): that is what makes "THRESHOLD_RULE_SETS.get(1) reproduces a v1
// decision exactly, after v2 lands" a property of the code rather than a hope.
//
// FAIL DIRECTION, once, for the whole file: every threshold here is an
// ASSERTION gate — it decides which claims are made to a founder, not which
// sessions are skimmed — so every one of them fails toward UNDER-DETECT
// (FR-9). A missed finding is recoverable; a false `broken` claim burns the
// credibility the MVP exists to test. Architecture D-1's "T1 fails toward
// including" governs the COST funnel (which sessions are skimmed), and this
// sprint contains no cost gate at all, so the two never meet. When O-005 adds
// the skim selector, its thresholds fail the other way and belong in their own
// rule set, not in this one.
//
// BOUNDARIES ARE INCLUSIVE, everywhere, stated once here (D-6): a threshold
// fires at `value >= threshold`, a window correlates at `delta <= windowMs`.
// Fail direction is carried by the MAGNITUDE, never by boundary strictness —
// and each magnitude's comment says what it is being conservative about.
import {
  BROKEN_PROOF_SIGNALS_V1,
  CHANGED_MIND_PROOF_SIGNALS_V1,
  CONFUSING_PROOF_SIGNALS_V1,
  INSTRUMENTATION_PROOF_SIGNALS_V1,
} from "../evidence/signals";
import type { ThresholdRuleSet } from "./types";

/** The rule set new judgements are made under. */
export const THRESHOLD_RULE_SET_VERSION = 1;

const RULE_SET_V1: ThresholdRuleSet = {
  version: 1,

  /** PostHog's own reserved literal, pinned by Addendum A ROW A-1 (20/20
   * observed, `$exception_list` present on every one). A name, so there is no
   * magnitude and no fail direction to declare. It lives here rather than in
   * `error-event.ts` so no detector body carries an event-name literal (D-18,
   * D9). */
  exceptionEventName: "$exception",

  /** UNDER-DETECT, and the strongest under-detect lever in this rule set.
   *
   * The vendor events that fire WITHOUT anybody doing anything: a page load, a
   * page unload, an identity stamp, a web-vitals report. None of them is a
   * thing a user was TRYING to do, so none may be named as the preceding
   * action of an exception. Without this list a `$pageview` followed thirty
   * seconds later by a third-party script error produces
   * `failure_correlated { precedingActionName: "$pageview" }` — the only
   * signal `brokenProofSignals` admits — and the gate then tells a founder
   * "we could prove the thing they were trying to do failed on them" when
   * nobody was trying to do anything. A wrong verdict in the customer's own
   * words is the one outcome §6's "no verdict beats a wrong verdict" and FR-14
   * exist to prevent.
   *
   * A DENYLIST, not an allowlist, and that direction is the whole design. The
   * T1 vocabulary probe pinned only `$exception` as present (Addendum A ROW
   * A-1); every interaction event name is therefore UNPINNED, so an allowlist
   * would be guesswork that silently drops real correlations for any name we
   * failed to guess. A denylist names only what we know to be passive and lets
   * the unknown case fall through to the action branch — over-detect for an
   * unknown passive vendor event, which the correlation window and
   * `errorMinAffectedSessions` still bound, rather than a blanket miss.
   *
   * Adding a name to this list can only ever remove correlations, never create
   * one: that is what keeps its fail direction UNDER-DETECT as it grows. */
  passiveEventNames: ["$pageview", "$pageleave", "$identify", "$web_vitals"],

  /** UNDER-DETECT: narrow enough that an exception 45 seconds after the click
   * is not attributed to it. A wider window buys more correlations and every
   * extra one is a coincidence dressed as a cause. */
  errorCorrelationWindowMs: 30_000,

  /** UNDER-DETECT: one session with an exception is an anecdote, not a
   * finding. Three is the smallest number that can carry the word "people". */
  errorMinAffectedSessions: 3,

  /** UNDER-DETECT: a denominator below 20 cannot support a rate claim to a
   * founder. "2 of 3 sessions dropped off" is arithmetic, not evidence. */
  funnelMinSessionsAtOrigin: 20,

  /** UNDER-DETECT: an absolute floor beneath the rate, so a 100% drop of 2
   * sessions never fires however extreme the ratio looks. */
  funnelMinDropoffSessions: 5,

  /** UNDER-DETECT: 40% is well above ordinary funnel attrition, so the claim
   * survives a founder who already knows their own numbers.
   *
   * An INTEGER PERCENTAGE, not `0.4`: `canonicalJson` refuses floating-point
   * values (D-13) and FR-11 hashes this rule set through it. It also makes the
   * inclusive boundary exact — `numerator * 100 >= 40 * denominator` has no
   * rounding, `numerator / denominator >= 0.4` does. */
  funnelDropoffRateThresholdPercent: 40,

  /** UNDER-DETECT: two visits to a path is navigation; three is a pattern. */
  struggleRepeatedAttemptMin: 3,

  /** UNDER-DETECT: observed must fall below 20% of expected before the class
   * fires, so ordinary week-to-week traffic variation never reads as an
   * instrumentation break. An INTEGER PERCENTAGE, for D-13's reason above. */
  instrumentationDropRatioPercent: 20,

  /** UNDER-DETECT: no rate claim on a tiny expected baseline. Fifty is where
   * "this event stopped firing" stops being indistinguishable from "this event
   * was always rare". */
  instrumentationMinExpected: 50,

  /** D-11 / FR-19. The blind-spot comment lives at the constant's definition
   * site in `../evidence/signals.ts`, not here. */
  brokenProofSignals: BROKEN_PROOF_SIGNALS_V1,
  confusingProofSignals: CONFUSING_PROOF_SIGNALS_V1,
  /** Plus the ABSENCE requirement, enforced in the predicate, not the list. */
  changedMindProofSignals: CHANGED_MIND_PROOF_SIGNALS_V1,
  instrumentationProofSignals: INSTRUMENTATION_PROOF_SIGNALS_V1,
};

/**
 * Every rule set ever shipped, keyed by version. When v2 lands,
 * `THRESHOLD_RULE_SETS.get(1)` still reproduces a v1 decision exactly, so a
 * threshold change is a detectable and migratable event rather than a silent
 * D12 fork of every judgement on record.
 *
 * FR-11: a golden test pins `sha256(canonicalJson(THRESHOLD_RULE_SETS.get(1)))`.
 * V1 IS A SHIPPED DECISION AND IS IMMUTABLE — add version 2, do not edit
 * version 1.
 */
export const THRESHOLD_RULE_SETS: ReadonlyMap<number, ThresholdRuleSet> = new Map([
  [1, RULE_SET_V1],
]);

/** The rule set `THRESHOLD_RULE_SET_VERSION` names. */
export const CURRENT_THRESHOLD_RULE_SET: ThresholdRuleSet = RULE_SET_V1;
