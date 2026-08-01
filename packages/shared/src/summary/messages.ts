// Every customer-facing string this lane produces lives here (following the one-home
// rule at `packages/shared/src/session-source/messages.ts:1-24`). One home means the
// plain-English audit below is a single-file review instead of a repo sweep, and a
// future consumer (the Slack renderer) imports these rather than re-authoring them. No
// wire between a producer and a consumer to sever.
//
// House rules these strings obey, each asserted by a named test below:
// No product jargon and no bare HTTP status number;
// Every `analysis_run_status` / `analysis_outcome` / `analysis_stop_reason`
//  / `summary_source` member reads distinctly, so a screen can never show
//  two situations the same way;
// `no_sessions_to_analyse` and `no_candidates_passed_gate` read as two
//  different answers to the same zero;
// Every `summary_source` sentence keyed `floor_*` is an absence
//  statement about the written explanation only — it never asserts
//  anything about the underlying finding, which is unchanged whichever
//  member applies. Read `packages/shared/src/gate/messages.ts:58-85`
//  before touching one of these: the previous incident there is exactly
//  the shape a positive-observation phrasing here would repeat (SAC-6).
//
// SAC-11: Never imply the dropped sessions are the struggling ones
//
// The rule. No summary sentence may imply that the sessions counted as dropped are the
// sessions counted as struggling. The two clauses may be about the same surface. They
// may never be about the same people.
//
// Forbidden, and this is the whole shape of it: any construction a reader would parse
// as one cohort. "we saw people struggling here, and 20 of 30 dropped", "people kept
// coming back and then left", "they tried a few times before giving up". Each is two
// individually TRUE clauses composing into one FALSE claim.
//
// Why it is FALSE, not merely unproven. The two cohorts are structurally disjoint.
// Provably, not incidentally. A funnel origin's destination set is built from the
// corpus's own walks, so the surface immediately following a session's first visit to
// that origin is by construction a member of that set. "Dropped at O" therefore reduces
// to "the walk ends at the session's first visit to O", so every dropped session
// visited O exactly once, while a struggling session is by definition one that visited
// it repeatedly. No session can be in both counts. Pinned by `D-2a — the dropped and
// struggling cohorts are structurally disjoint` in
// `packages/core/__tests__/detect/funnel-dropoff.test.ts`.
//
// Permitted composition, stated so a renderer author has a rule and not a warning: the
// two clauses may sit in one summary provided each names its own count with its own
// denominator and neither borrows the other's subject. Say "this page was revisited
// repeatedly by some sessions" and "20 of 30 sessions left it without going anywhere it
// could have gone" as two separate observations about the page. Never join them with a
// pronoun, a "then", or an "and then" that hands one cohort the other's behaviour.
//
// Who this protects. The non-technical reader who repeats the sentence to a third
// party. They cannot re-derive which cohort a clause referred to, so a conflated
// sentence does not merely mislead them, it travels.
//
// This row ships before its consumer, deliberately. The renderer that must obey it is
// the follow-on sprint's; a contract written after the code it governs is a contract
// nobody applied. Its mechanical guard test lands with that renderer as an inherited
// obligation.
//
// Numbering: this is SAC-11. The requirement arrived labelled "SAC-7", which collides
// with the existing SAC-7 (no causal connective). SAC-1 through SAC-10 are all taken;
// renumbered rather than overloaded.
import type {
  AnalysisOutcome,
  AnalysisRunStatus,
  AnalysisStopReason,
  SummarySource,
} from "./types";

/** The three states a customer (or a support screen) can see a run in. */
export const ANALYSIS_RUN_STATUS_MESSAGES: Record<AnalysisRunStatus, string> = {
  running: "We are looking at what happened in your product right now.",
  completed: "We finished this check of your product.",
  failed:
    "Something went wrong partway through this check, and we could not finish it. We will try again on the next check.",
};

/**
 * What a completed run found. `no_sessions_to_analyse` and `no_candidates_passed_gate`
 * are kept distinct on purpose. "we have not looked yet" and "we looked and your
 * product was quiet" are different answers to the same zero.
 */
export const ANALYSIS_OUTCOME_MESSAGES: Record<AnalysisOutcome, string> = {
  produced_findings: "We found something in your product worth telling you about.",
  no_candidates_passed_gate:
    "We looked at what happened in your product, and nothing we saw was solid enough for us to report yet.",
  no_sessions_to_analyse:
    "There has not been enough activity in your product yet for us to look for anything.",
};

/** Why a run stopped looking. `cap_exhausted` must never read as "nothing left to find"
 * (SAC-10). It is a stated limit, not an empty product. */
export const ANALYSIS_STOP_REASON_MESSAGES: Record<AnalysisStopReason, string> = {
  ran_to_completion: "We checked everything there was to check this time.",
  cap_exhausted:
    "We stopped early because we reached the limit on how many written explanations we can generate during your product's first check. Nothing found after that point was left out — it just did not get a written explanation.",
  fatal_error: "An unexpected problem ended this check before it could finish.",
};

/**
 * How a finding's written summary was produced. Every `floor_*` sentence states only
 * that a written explanation is missing and why, never a claim about the finding
 * itself, which is identical whichever member applies.
 */
export const SUMMARY_SOURCE_MESSAGES: Record<SummarySource, string> = {
  model_rendered: "This includes a short written explanation alongside the numbers.",
  floor_no_key_configured:
    "This shows the numbers on their own. Written explanations are not set up for this installation yet.",
  floor_cap_exhausted:
    "This shows the numbers on their own. The limit on written explanations for this product's first check was already reached.",
  floor_model_call_failed:
    "This shows the numbers on their own. An attempt to add a written explanation did not complete.",
  floor_model_output_invalid:
    "This shows the numbers on their own. What came back could not be read as a written explanation.",
  floor_model_text_rejected:
    "This shows the numbers on their own. A written explanation was generated but did not pass our accuracy check, so we left it out.",
};

// The floor renderer's vocabulary
//
// Fixed templates, as data. Substitution happens in `packages/core`; nothing below is a
// function, and that is load-bearing rather than stylistic: the audit at
// `packages/shared/__tests__/summary/messages.test.ts:80-97` derives its corpus from
// this module's string exports and objects of strings and skips functions, so a table
// opts every sentence in it into the hostile plain-English review for free, while a
// builder function would escape that review entirely.
//
// The token vocabulary is closed: `{surface}`, `{numerator}`, `{denominator}`,
// `{unit}`, `{windowStart}`, `{windowEnd}`. Nothing else is a legal placeholder. A
// token nobody substitutes would reach a reader verbatim, so the renderer refuses any
// template it cannot fully resolve rather than printing a half-filled sentence.
//
// Every template below obeys, and each is checked mechanically:
// Exactly one sentence, ending in exactly one full stop;
// No `they` / `them` / `their`. Every sentence names its own subject, so
//  two facts standing next to each other can never be read as one group of
//  sessions. That is the whole shape of the SAC-11 block at the top of this
//  file: a pronoun is what hands one group the other's behaviour;
// No instruction and no next step. The floor says what was measured and
//  stops. Nothing shipped can act on a finding yet, and a sentence that
//  implied otherwise would be promising work that does not exist;
// No visit ordering. Neither "first" nor "last" visit is named, so
//  whichever visit a drop ends up counted at, no sentence here becomes
//  false;
// No machine identifier. No class name, no detector name, no predicate
//  name, no version;
// No connective welding two claims into a cause.

/**
 * The finding classes, restated here as a literal union.
 *
 * This is a second statement of `FindingClass`, whose home is
 * `packages/core/src/rules/types.ts`. Unavoidable, because `shared` may not import
 * `core`. The technique, and this comment's shape, are the ones already shipped at
 * `packages/shared/src/gate/messages.ts:21-35`. The two statements cannot drift
 * silently, in either direction:
 *
 * A class added in `core` without its sentence here is a **compile
 *  error**, because `packages/core/src/summary/floor.ts` annotates its
 *  import of `FLOOR_OBSERVATION_TEMPLATES` as a `Record` over the real
 *  `FindingClass`, and a missing key fails that assignment;
 * A key added here without a class in `core` is a **test failure**, via
 *  `the floor template table has exactly one entry per FindingClass` in
 *  `packages/core/__tests__/summary/floor.test.ts`, which compares this
 *  table's keys against the schema's own members.
 */
type FloorFindingClass = "broken" | "confusing" | "changed_mind" | "instrumentation";

/**
 * How much weight the evidence can bear, restated as a literal union.
 *
 * A second statement of `ConfidenceBasis`, whose home is
 * `packages/core/src/findings/candidate.ts:30-40`. Same two directions, same mechanism
 * as the union above: a member added in `core` without its sentence here is a compile
 * error at the renderer's `Record` annotation, and a key added here with no member in
 * `core` is a test failure in `packages/core/__tests__/summary/floor.test.ts`.
 */
type FloorConfidenceBasis = "threshold_met" | "at_threshold" | "below_threshold";

/**
 * What each of a candidate's counts means, restated as a literal union.
 *
 * A second statement of `CountRole`, whose home is
 * `packages/core/src/summary/count-roles.ts`. The roles exist at all because a
 * candidate's counts arrive as a positional array with no label on them, so the only
 * thing standing between a reader and the wrong number under the right sentence is that
 * the position is resolved to a named role before any sentence is chosen. Same two
 * drift directions as the unions above: a role added in `core` without its sentence
 * here is a compile error at the renderer's `Record` annotation; a key added here with
 * no role in `core` is a test failure in
 * `packages/core/__tests__/summary/floor.test.ts`.
 */
type FloorCountRole = "reached_surface" | "left_without_continuing" | "affected_sessions";

/**
 * The observation sentence, keyed by the class the gate concluded.
 *
 * Read this before making one of them more vivid. It is the same rule the comment at
 * `packages/shared/src/gate/messages.ts:58-85` records, at the one other place it can
 * recur. A sentence keyed by an outcome is emitted on every path to that outcome, so it
 * may assert only what is true on the weakest such path. `broken_unsatisfied` shipped
 * reading "We saw people struggling here" on paths where nobody had struggled; the
 * mechanism was exactly this.
 *
 * Each row below names the proof that must have held for its key to be the final class,
 * and asserts no more than that proof establishes. Where a proof carries no cohort
 * magnitude, the sentence does not say "people".
 */
export const FLOOR_OBSERVATION_TEMPLATES: Record<FloorFindingClass, string> = {
  // Licensed by `brokenProofSatisfied`
  // (`packages/core/src/evidence/predicates.ts:153`): a failure signal tied to the
  // action that came before it, carried by at least `errorMinAffectedSessions`
  // sessions. Three, "the smallest number that can carry the word people"
  // (`packages/core/src/rules/thresholds.ts:107-109`). The plural subject is licensed
  // by that magnitude. The sentence claims a thing people do here does not work, and
  // stops: Why it does not work is not something any predicate established.
  broken: "Something people are doing on {surface} is not working.",

  // Licensed by `confusingProofSatisfied`
  // (`packages/core/src/evidence/predicates.ts:181`): a repeated-attempt signal
  // carrying both enough return visits within one session to be a pattern rather than
  // navigation, and enough separate sessions doing it for "people" to be the true word.
  // Three of each (`packages/core/src/rules/thresholds.ts:133,161`). Repetition is the
  // whole claim. The sentence names no leaving, so it cannot be read together with a
  // magnitude sentence about sessions that left (SAC-11).
  confusing: "People are coming back to {surface} over and over.",

  // No live path. Nothing in this repository can produce a candidate carrying this
  // class: no detector may propose it (`packages/core/src/rules/types.ts:43`), and it
  // is unreachable as a downgrade destination. Its row in the downgrade map is "drop"
  // (`packages/core/src/evidence/gate.ts:68`). The row exists because the final class
  // is typed over all four classes, not because anything arrives here.
  //
  // Licensed by `changedMindProofSatisfied`
  // (`packages/core/src/evidence/predicates.ts:210`) if anything ever did arrive: a
  // clean-exit signal present, and no failure and no struggle signal of any kind. That
  // predicate puts NO magnitude on the clean exit (a single session satisfies it) so
  // the page is the subject of this sentence and "people" is not, unlike the two above.
  changed_mind: "{surface} is being left without anything going wrong.",

  // Licensed by `instrumentationProofSatisfied`
  // (`packages/core/src/evidence/predicates.ts:237`): one known kind of activity
  // arriving at or below its allowed share of what was expected, and only on an
  // expected count large enough to carry the comparison. "Almost stopped arriving" is
  // the wording the gate already uses for this same predicate
  // (`packages/shared/src/gate/messages.ts:97`).
  //
  // The sentence stops at the observation. Whether the cause is the tracking or the
  // product is a second claim, and no predicate settles it. Joining it on here would
  // need the causal connective this vocabulary refuses, and would state as fact
  // something nothing measured.
  instrumentation: "One kind of activity we normally see on {surface} has almost stopped arriving.",
};

/**
 * The magnitude sentence for each count role.
 *
 * Every value carries `{numerator}`, `{denominator}` and `{unit}` in one string. That
 * is what makes "a count never appears without its denominator" a structural property
 * instead of a rule a caller has to remember: there is no template here that carries a
 * numerator alone, so there is no call shape that can render one. A bare number in
 * front of a founder is a claim whose size cannot be judged.
 *
 * `{unit}` is always "sessions", `MeasuredCount.unit` is the literal `"sessions"` and
 * never "people" (`packages/core/src/counts/measured-count.ts:70-77`), because this
 * product does not stitch one person's visits together, and rendering a session count
 * as a people count would be a larger claim than the one that was measured.
 */
export const FLOOR_COUNT_TEMPLATES: Record<FloorCountRole, string> = {
  /** The sessions that arrived at the page this claim is about. */
  reached_surface: "{numerator} of {denominator} {unit} reached {surface}.",

  /**
   * The count's meaning, with no visit ordering in it: the sentence names neither the
   * first nor the last visit, so the open question of which visit a drop is counted at
   * can change the number without making this sentence false. The phrasing is the
   * permitted composition stated at the top of this file. A separate observation about
   * the page, borrowing no subject from the sentence before it (SAC-11).
   */
  left_without_continuing:
    "{numerator} of {denominator} {unit} left {surface} without going anywhere it could have gone.",

  /**
   * The single magnitude a detector reading exceptions claims. It says only that these
   * sessions were affected: What they ran into is the observation sentence's claim, and
   * repeating it here would state it twice as though it had been measured twice.
   */
  affected_sessions: "{numerator} of {denominator} {unit} were affected on {surface}.",
};

/**
 * How much weight the evidence carries, in words.
 *
 * No value here contains a digit, and none may ever. There is no numeric confidence
 * anywhere in this product; inventing one here (a percentage, a score out of ten) would
 * put a precision in front of a reader that nothing computed, and it would be the
 * reader's most memorable takeaway precisely because it looks exact.
 *
 * The three sit either side of one boundary, and the middle one exists because "exactly
 * at the line" is a different fact from "past the line" and is worth saying out loud.
 */
export const FLOOR_CONFIDENCE_TEMPLATES: Record<FloorConfidenceBasis, string> = {
  /** Above every level the detector applied. "above", because the exactly-at case is
   * its own member below, so this sentence may not claim a margin it does not know the
   * size of. */
  threshold_met: "The numbers behind this sit above the level we ask for before we say anything.",
  /** Exactly at the inclusive boundary. Named rather than folded into the row above, so
   * a reader is told it was close. */
  at_threshold:
    "The numbers behind this sit exactly at the level we ask for before we say anything, and no higher.",
  /** Below the level. Stated plainly rather than softened: a reader who cannot tell
   * this apart from the row above has been misled about the one thing this sentence
   * exists to say. */
  below_threshold: "The numbers behind this sit below the level we ask for before we say anything.",
};

/**
 * The window every count above was measured over.
 *
 * Both ends are stated as dates rather than as a phrase like "in the last week": a
 * relative phrase is relative to a moment this text cannot read, and it stops being
 * true the day after it is written. In a message a reader may open, or forward, long
 * after it was produced.
 */
export const FLOOR_TIMEFRAME_TEMPLATE: string =
  "This covers what happened between {windowStart} and {windowEnd}.";

/**
 * What is said when every session in the window was set aside, leaving a denominator of
 * zero.
 *
 * Never a division result and never a blank. Dividing by that zero produces something
 * that is not a number and would reach a reader as one; a blank reads as "nothing
 * happened", which is a different and false answer. The honest answer is that there was
 * nothing left to measure against, and it is stated in words.
 */
export const FLOOR_NO_RATE_TEMPLATE: string =
  "Every session in this window was set aside, leaving no share to report.";

/**
 * Every fixed customer-facing string this lane produces, in one array, so the
 * plain-English audit below is total rather than best-effort: a new constant that is
 * not added here is caught by the completeness test instead of quietly escaping review.
 */
export const ALL_CUSTOMER_FACING_MESSAGES: readonly string[] = [
  ...Object.values(ANALYSIS_RUN_STATUS_MESSAGES),
  ...Object.values(ANALYSIS_OUTCOME_MESSAGES),
  ...Object.values(ANALYSIS_STOP_REASON_MESSAGES),
  ...Object.values(SUMMARY_SOURCE_MESSAGES),
  ...Object.values(FLOOR_OBSERVATION_TEMPLATES),
  ...Object.values(FLOOR_COUNT_TEMPLATES),
  ...Object.values(FLOOR_CONFIDENCE_TEMPLATES),
  FLOOR_TIMEFRAME_TEMPLATE,
  FLOOR_NO_RATE_TEMPLATE,
];
