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
export const THRESHOLD_RULE_SET_VERSION = 2;

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

  /**
   * THE FAIL-DIRECTION FIX for the denylist above (O-004 edge sweep, D10).
   *
   * The reasoning above is right that interaction names are unpinned, but its
   * conclusion inverted this file's own priority. A denylist lets an UNKNOWN
   * vendor event fall through to the action branch — so `$feature_flag_called`,
   * `$set`, `$groupidentify` or any future PostHog release name becomes "the
   * thing the user was trying to do", and the gate then tells a founder we
   * proved their user's action failed when nobody was trying to do anything.
   * That is the wrong-verdict outcome §6 and FR-14 exist to prevent, and this
   * file names it as the worst case four paragraphs above.
   *
   * The split below needs no guessing, because it keys on WHOSE event it is
   * rather than on what it is called:
   *
   * - No `$` prefix: the customer instrumented it themselves. `checkout_submitted`
   *   is a user action by construction. Every real correlation the denylist was
   *   protecting lives here, so nothing is dropped.
   * - `$` prefix: PostHog's own. Passive UNLESS listed as user-initiated —
   *   a set that is small, knowable, and does not grow with traffic.
   *
   * Unknown vendor names now fail toward SILENCE instead of toward a false
   * claim. Adding a name here can only ever create correlations, so the list
   * is the one thing to review when a real interaction is being missed.
   */
  vendorEventPrefix: "$",
  userInitiatedVendorEvents: ["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"],

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

  /** UNDER-DETECT: two visits to a path is navigation; three is a pattern.
   *
   * A PER-SESSION magnitude — one person's visit depth, never a cohort total.
   * `struggleMinStrugglingSessions` below is the cohort half, and the two are
   * separate because only one of them survives a bigger corpus. */
  struggleRepeatedAttemptMin: 3,

  /** UNDER-DETECT, and the reason `struggleRepeatedAttemptMin` is safe to read
   * as a per-session maximum.
   *
   * `struggle` is the ONLY producer of `confusing` proof this sprint, and
   * `confusing` is the only class a T1 detector can carry through the gate — so
   * this pair is the single gate between drop-off arithmetic and a delivered
   * finding. The per-session maximum ALONE cannot hold it: a maximum over a
   * cohort is monotonically increasing in corpus size, so at
   * `DETECTOR_CORPUS_MAX_SESSIONS` (500) one outlier revisiting a comparison
   * page three times would set `struggle` for the whole surface — a predicate
   * firing on a SUPERSET of its target ("at least one session came back"),
   * which is the D10 conflation this sprint exists to prevent.
   *
   * THREE, for the same reason `errorMinAffectedSessions` is three: it is the
   * smallest number that can carry the word "people", and the sentence a
   * founder actually reads on a satisfied `confusing` rung says exactly that —
   * "People hesitated, went back, or tried the same thing more than once here."
   * One outlier session makes that sentence false in the customer's own words,
   * which §6's "no verdict beats a wrong verdict" and FR-14 exist to prevent.
   *
   * An ABSOLUTE floor rather than a share of the cohort, deliberately: the
   * denominator a signal can carry is `basis.kept` (the whole analysed corpus),
   * not the at-origin cohort, so a percentage here would be a rate over the
   * wrong base — a subtler lie than a floor. The origin cohort is separately
   * bounded by `funnelMinSessionsAtOrigin`. Tightening this to a share belongs
   * in a v2 calibrated against a real corpus, not in a guess here. */
  struggleMinStrugglingSessions: 3,

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
 * D-3 (O-005). SAME NUMBERS AS RULE_SET_V1 — spread from it, deliberately, so
 * "the numeric values are unchanged" is a fact the compiler and the runtime
 * both reuse rather than a claim a reviewer has to eyeball across two blocks
 * — WHAT CHANGED IS WHICH QUANTITY THE NUMBERS MEASURE.
 *
 * Under v1, `funnelMinSessionsAtOrigin`, `funnelMinDropoffSessions` and
 * `funnelDropoffRateThresholdPercent` were evaluated once per
 * (origin, destination) PAIR — the funnel detector's emission loop ran one
 * gate check per destination reachable from an origin
 * (`../detect/funnel-dropoff.ts`, pre-D-2 shape). D-2's aggregation rewrite
 * (O-005) collapses that emission to at most one candidate PER ORIGIN:
 * `visited` and `dropped` are now counted once, across every destination `O`
 * can reach, not compared destination by destination. The same three
 * constants below now gate a per-origin quantity instead of a per-pair one.
 *
 * THIS IS THE D12 HAZARD THIS FILE'S OWN HEADER COMMENT WARNS ABOUT, MADE
 * CONCRETE. Holding the version at 1 while the measured quantity changed
 * underneath it would have silently reinterpreted every threshold decision
 * already on record — exactly the "unversioned normalisation feeding a dedup
 * key" fork D12 names. Bumping to v2 is what keeps
 * `THRESHOLD_RULE_SETS.get(1)` a truthful, permanent answer to "what did v1
 * actually gate", the same discipline `exclusionRuleSetVersion` and
 * `groupingVersion` exist for at
 * `packages/db/src/services/intake.service.ts:151-155` (verbatim: "When a v2
 * rule set lands, `EXCLUSION_RULE_SETS.get(1)` still reproduces this row's
 * stamp exactly, so a rule change is a migratable event rather than a silent
 * fork").
 *
 * NO SECOND REASON — AND THE ARITHMETIC SAYS SO. An earlier draft of this
 * comment argued that aggregation made `funnelMinDropoffSessions: 5` newly
 * REACHABLE, and offered that as an independent justification for the bump.
 * It is false. The floor was structurally unreachable under v1 and REMAINS
 * structurally unreachable under v2: a candidate must clear all three gates
 * in order (`../detect/funnel-dropoff.ts`), and gate 1 forces
 * `atOrigin >= funnelMinSessionsAtOrigin` (20), so gate 3
 * (`dropped * 100 >= funnelDropoffRateThresholdPercent * atOrigin`) demands
 * `dropped >= 40 * 20 / 100 = 8`. Eight subsumes five, so deleting the
 * `funnelMinDropoffSessions` check would change no outcome — under v2 exactly
 * as under v1. Aggregation raises the numerator (`dropped`) and the
 * denominator (`atOrigin`) together; it cannot move a floor that the rate gate
 * already dominates at the smallest legal denominator.
 *
 * Following the O-004 precedent, that property is PINNED BY A NAMED TEST
 * rather than left as prose a reader has to re-derive — grep
 * `thresholds.test.ts` for `funnelMinDropoffSessions remains structurally
 * unreachable under v2 aggregation`. It derives the rate-implied floor from
 * the rule set's own three values, so a future threshold edit that makes the
 * floor genuinely reachable fails that test and forces this paragraph to be
 * rewritten honestly.
 *
 * The bump therefore stands on the SEMANTIC change above, alone — which is
 * sufficient on its own.
 *
 * TRADE-OFF ACCEPTED (ADD §8.4): a reader diffing RULE_SET_V1 against
 * RULE_SET_V2 sees identical numbers and must read this comment to learn
 * what changed. That is the accepted cost of versioning semantics rather
 * than values — do not "fix" the apparent no-op diff by nudging a number;
 * the numbers are correct exactly as printed.
 */
const RULE_SET_V2: ThresholdRuleSet = {
  ...RULE_SET_V1,
  version: 2,
};

/**
 * Every rule set ever shipped, keyed by version. `THRESHOLD_RULE_SETS.get(1)`
 * still reproduces a v1 decision exactly now that v2 has landed, so a
 * threshold change is a detectable and migratable event rather than a silent
 * D12 fork of every judgement on record.
 *
 * FR-11: a golden test pins `sha256(canonicalJson(THRESHOLD_RULE_SETS.get(1)))`.
 * V1 IS A SHIPPED DECISION AND IS IMMUTABLE — add version 3 for the next
 * change, do not edit version 1 or version 2.
 */
export const THRESHOLD_RULE_SETS: ReadonlyMap<number, ThresholdRuleSet> = new Map([
  [1, RULE_SET_V1],
  [2, RULE_SET_V2],
]);

/** The rule set `THRESHOLD_RULE_SET_VERSION` names. */
export const CURRENT_THRESHOLD_RULE_SET: ThresholdRuleSet = RULE_SET_V2;
