// Every fixed customer-facing string the delivery lane produces lives here, following
// the one-home rule already applied at `../session-source/messages.ts:1-24`,
// `../summary/messages.ts:1-7` and `../signatures/messages.ts:1-14`.
//
// One home, for the same three reasons those files give. The plain-English audit in
// `__tests__/delivery/messages.test.ts` is a single-file review rather than a repo
// sweep. The Slack renderer in `packages/core/src/delivery/slack-message.ts`
// imports these rather than re-authoring them, so there is no second copy to drift and
// no wire between a producer and a consumer to sever. A string that reaches a
// founder is reviewable as English, in one place, by somebody who has never read the
// code.
//
// How the renderer reaches these `@growthmind/shared` exposes exactly one entry point
// (its `package.json` `exports` map is `{ ".": "./src/index.ts" }`), so `packages/core`
// cannot deep import this module. It receives `DELIVERY_VOCABULARY` below as a required
// argument. Required, and typed as a total `Record` keyed by the same closed union
// declared in `./types.ts`, so the two ends cannot disagree about which members exist:
// a member added there without a sentence here is a compile error on this file, and a
// caller that forgets the argument is a compile error at the call site. That is the
// mitigation for a value one package computes and another consumes. The key set is not
// hand-passed, it is the union.
//
// House rules these strings obey, each asserted by a named test
// **No product jargon.** The banned list is imported from
//  `../signatures/messages.ts` — one vocabulary, not two, which is what
//  `packages/core/src/counts/measured-count.ts:30` requires of this sprint.
// **A session is never a person.** Identity stitching does not exist in
//  this product (`measured-count.ts:60-69`), so no string here says people,
//  users, customers or visitors. "3 of 40" means 3 of 40 sessions, and a
//  sentence sitting beside that count may not quietly re-label it.
// **A sentence keyed by a lane state alone asserts only what that state
//  establishes.** `nothing_today` says we have nothing to send; it never
//  says the product is healthy. `failed` says we could not post; it never
//  says the finding went away. This is the paid-for failure, and the
//  same rule `../signatures/messages.ts:17-30` states.
// **`null` where a state speaks for itself.** A delivered finding IS the
//  message; a `posted` row's evidence is the post. Inventing a sentence for
//  either would be a claim nothing established, so those members are `null`
//  — explicitly, never `""` and never a placeholder.
//
// This module deliberately re-exports nothing from `../signatures/messages.ts`.
// `FORBIDDEN_PRODUCT_JARGON` is imported by the audits that scan these strings, not by
// the strings themselves, and a re-export here would give one list two names in the
// package barrel, which is how a second list starts.
import type { PostFailureCode } from "./poster";
import type {
  DeliveryDecision,
  DeliveryStatus,
  NothingTodayReason,
  ResidualPiiKind,
} from "./types";

/**
 * The lead sentence of a nothing-today post, kept as its own constant because the
 * renderer needs it as a `string`. Reading it out of the `string | null` map below
 * would need a non-null assertion at every call site.
 *
 * May assert: we looked, and we are choosing not to send anything. May not assert: that
 * the product is fine, that nothing went wrong, or that there is nothing to find. None
 * of which a decision to stay quiet can know.
 */
export const NOTHING_TODAY_LEAD =
  "We looked at what happened in your product, and we are not sending you anything today.";

/**
 * The scheduler's decision, in the customer's words.
 *
 * `Record<DeliveryDecision, string | null>` is total by construction: adding a member
 * to `deliveryDecisionSchema` without a sentence here is a compile error, not
 * `undefined` rendered into Slack.
 */
export const DELIVERY_DECISION_MESSAGES: Record<DeliveryDecision, string | null> = {
  // A delivered finding speaks for itself. The message IS the finding. A preamble
  // saying "we are sending you something" is a sentence about us rather than about the
  // product, and it costs a line of the reading budget.
  deliver: null,

  nothing_today: NOTHING_TODAY_LEAD,
};

/**
 * Why today is a quiet day. These are the distinguishable zeros (`./types.ts:35-43`):
 * "you still owe us an answer", "we looked and nothing was solid enough", and "we are
 * pacing ourselves" are three different facts and must never read as one sentence.
 */
export const NOTHING_TODAY_REASON_MESSAGES: Record<NothingTodayReason, string> = {
  // May: something we already sent is still waiting on an answer, and that is
  // deliberate, one open thing at a time. May not: that nothing else was found. We
  // stopped looking for a second thing to send; we did not establish there was none.
  one_already_open:
    "The last thing we sent is still waiting on an answer, and we only keep one of those open at a time. Once it is answered we will move on to the next one.",

  // May: we looked, and nothing cleared the bar we set before we will say anything. May
  // not: that the product is fine, or that nothing went wrong. A bar we did not clear
  // is a statement about our own confidence.
  no_findings_ready:
    "We checked what happened and nothing was solid enough for us to put in front of you yet. We would rather stay quiet than send you something we cannot stand behind.",

  // May: we are pacing on purpose, and that is not a fault. May not: that there is
  // nothing left to send. That is exactly what a spent budget cannot tell us, and
  // reading it that way would make a quiet product out of a busy one (the SAC-10 shape
  // at `../summary/messages.ts:95-102`).
  budget_spent:
    "We have already sent everything we will send for now. Nothing is wrong — we hold back on purpose so that what does arrive is worth reading.",
};

/**
 * Where a delivery attempt got to. Every exit path records `posted` or `failed`
 * (`./types.ts:57-63`), so these sentences are the only thing standing between a
 * stuck row and a founder who thinks we went silent.
 */
export const DELIVERY_STATUS_MESSAGES: Record<DeliveryStatus, string | null> = {
  // Transparency over silence: work that is in flight says so
  // (`.claude/rules/event-transparency.md`).
  pending: "We are posting this to Slack now.",

  // The post itself is the evidence. Nothing to add.
  posted: null,

  // May: we could not post it, and the finding is untouched. May not: that the finding
  // is gone, wrong, or withdrawn. A delivery failure is a fact about Slack, not about
  // the product.
  failed:
    "We could not get this into Slack. Nothing about what we found has changed, and we will try again.",
};

/**
 * What we tell a founder when the last check before posting found something that looks
 * like personal data in generated text.
 *
 * Keyed by what it is, never by the pattern that found it, and the sentence never
 * quotes the match. Echoing it would copy the personal data into the very place we
 * refused to send it (`./types.ts:75-84`).
 *
 * May assert: what the shape looked like, and that we held the post back. May not
 * assert: that it definitely IS personal data. This gate fails closed on doubt by
 * design (`packages/core/src/delivery/residual-pii.ts:14-27`), so a sentence claiming
 * certainty would be wrong on exactly the cases the gate exists for.
 */
export const RESIDUAL_PII_KIND_MESSAGES: Record<ResidualPiiKind, string> = {
  email_address:
    "Part of this looked like an email address, so we held the post back rather than put it in a shared channel.",
  phone_number:
    "Part of this looked like a phone number, so we held the post back rather than put it in a shared channel.",
  payment_card:
    "Part of this looked like a payment card or account number, so we held the post back rather than put it in a shared channel.",
  ip_address:
    "Part of this looked like a network address, so we held the post back rather than put it in a shared channel.",
  credential:
    "Part of this looked like a key or password, so we held the post back rather than put it in a shared channel.",
};

/**
 * The zero-denominator sentence (
 * `packages/core/src/counts/measured-count.ts:44-50`).
 *
 * A window where every session was set aside is a real, reportable state, not an error
 * and not a missing number. It reaches the founder as this sentence and never as "0%",
 * which would claim we measured something and found none of it. The opposite of what
 * happened.
 */
export const NO_RATE_SENTENCE =
  "Every session we looked at was set aside, so there is no share to report.";

/**
 * What HAPPENED when one POST attempt failed, keyed by mechanism.
 *
 * ###########################################################################
 * # THIS TABLE STATES FACTS. IT DOES NOT NAME NEXT ACTIONS.
 * #
 * # It is read by more than one surface, and the same mechanism has different
 * # repairs on each of them. A next action written here is written for
 * # whichever surface the author happened to have in mind, and is then wrong
 * # everywhere else — silently, because nothing about a sentence says which
 * # screen it was aimed at.
 * #
 * # WHAT IT COST BEFORE THE SPLIT. `channel_unavailable` used to end "Someone
 * # will need to pick another one." The first-run screen appends its own
 * # clause to whatever it finds here, so a founder read two next actions in
 * # one paragraph and they contradicted each other: pick another channel, and
 * # invite the bot to the one already chosen. Picking another is not an act
 * # this product serves at all — `attachChannel` fills an empty address and
 * # never moves a chosen one, because the delivery row's identity carries the
 * # channel and re-pointing would replay an organization's whole backlog.
 * #
 * # SO THE INSTRUCTION MOVED OUT, ONCE PER SURFACE:
 * #   delivery lane -> `DELIVERY_LANE_FAILURE_CLAUSE` below
 * #   first-run     -> `ONBOARDING_CLAUSE` in `../onboarding/slack-test.ts`
 * # Each is composed onto the fact by the surface that owns it, and neither
 * # can reach the other.
 * ###########################################################################
 *
 * Distinct from `DELIVERY_STATUS_MESSAGES`, which speaks at row level ("we could not
 * get this into Slack"). These speak at attempt level, which of four different things
 * actually happened, which is the whole reason `postFailureCodeSchema` splits four ways
 * instead of one.
 *
 * They live here, not beside the Slack adapter that authored them, because this module
 * is the delivery lane's one home and `ALL_DELIVERY_MESSAGES` below is the
 * plain-English audit. `signatures/messages.ts` shipped standalone with its own audit,
 * but explicitly as the fallback for when the aggregate's home was contested; this one
 * is not contested, so the same precedent says join it. Four customer-facing sentences
 * sitting outside the aggregate is exactly the drift the aggregate exists to prevent.
 *
 * House rules each obeys, beyond the module header's:
 * Every one says the finding itself is untouched. A delivery failure is a
 *  fact about Slack, never a fact about what we found — and none of them
 *  claims the product is fine or that the finding has gone away. That clause
 *  stays: it is a FACT about what did not change, not an instruction.
 * Each states a different thing that happened. Two identical sentences would
 *  throw away the distinction the port paid four codes for.
 */
export const POST_FAILURE_MESSAGES: Record<PostFailureCode, string> = {
  // "We will try again" is a fact about the lane's own behaviour, not an instruction to
  // anybody, and it is true on both surfaces: a `failed` delivery row is re-claimable by
  // a later tick, and the first-run card keeps its send button. Left alone.
  call_failed:
    "We could not get this into Slack just now. Nothing about what we found has changed, and we will try again.",

  // "Sending the same thing again would not help" is a fact about the mechanism — the
  // same bytes get the same answer — and it is true wherever this renders. Left alone.
  rejected:
    "Slack would not accept this message as we built it, so it has not arrived. Sending the same thing again would not help. Nothing about what we found has changed.",

  // This one DOES carry an act, and it stays, because it is the SAME act on every
  // surface: the first-run clause (`SLACK_MUST_RECONNECT`) names reconnecting too, and
  // adds only the part a founder cannot work out — that pressing again cannot help. An
  // instruction that is identical everywhere is not the surface-specific kind this split
  // exists to separate, and moving it would leave the lane silent for no gain.
  not_authorised:
    "Slack is no longer letting us post on your behalf, so someone will need to reconnect it before anything can arrive. Nothing about what we found has changed.",

  // WHAT HAPPENED, AND THEN IT STOPS. Three possible mechanisms, none of which this
  // table can distinguish between and none of which it may prescribe a repair for.
  channel_unavailable:
    "We could not post to the channel that was chosen — it may have been archived or deleted, or we may no longer be in it. Nothing about what we found has changed.",
};

/**
 * The DELIVERY LANE's next action, per code — the half `POST_FAILURE_MESSAGES` above
 * deliberately no longer carries.
 *
 * Total over the union on purpose, exactly as `ONBOARDING_CLAUSE` is: a fifth failure
 * code cannot be added without somebody deciding, in this file, what the lane tells a
 * customer to do about it. A partial map would let it default to silence.
 *
 * THREE OF THE FOUR ARE SILENT, AND EACH FOR ITS OWN REASON. `call_failed` already says
 * we will try again, `rejected` already says a repeat would not help, and
 * `not_authorised` already names reconnecting. A clause repeating any of those would be
 * this table authoring a second answer to a question the fact already answers — the
 * failure mode that produced the two-next-actions paragraph in the first place.
 *
 * WHY `channel_unavailable`'S CLAUSE IS NOT "PICK ANOTHER ONE", WHICH IS WHAT THE FACT
 * TABLE USED TO SAY. Re-pointing a stamped address is not something this product does on
 * ANY surface: `attachChannel` fills an empty address and never moves a chosen one
 * (`packages/db/src/repositories/slack-connections.repo.ts`), and nothing outside tests
 * calls `deactivate` on a Slack connection, so there is no shipped route back to the
 * picker either. Carrying that sentence into the lane would have moved the defect one
 * surface across rather than fixed it: a customer sent looking for a control that does
 * not exist, while the repair that does work goes unnamed.
 *
 * WHAT DOES WORK, for two of the three mechanisms the fact names: the channel is
 * archived, or the bot is out of it, and both are undone over in Slack. The third —
 * deleted — has no repair anywhere, and the fact sentence has already named it as a
 * possibility rather than this clause pretending otherwise.
 *
 * AND THE LANE'S OWN PROMISE IS TRUE. A `failed` delivery row is re-claimable
 * (`DeliveriesRepo.claimForPost`), so a later tick posts the same finding to the same
 * channel with no press from anybody. "We will keep trying" is the lane describing
 * itself, which is the one thing it can always honestly do.
 */
export const DELIVERY_LANE_FAILURE_CLAUSE: Record<PostFailureCode, string | null> = {
  call_failed: null,
  rejected: null,
  not_authorised: null,
  channel_unavailable:
    "Someone has to make that channel reachable again in Slack — unarchive it, or invite the bot back in. We will keep trying.",
};

/**
 * The delivery lane's failure sentence: the fact, then the lane's own next action.
 *
 * Composed HERE rather than at the worker's call site, for the reason the module header
 * gives about the renderer: a customer-facing sentence assembled outside this package is
 * a sentence outside `ALL_DELIVERY_MESSAGES`, and a second lane consumer would have to
 * remember to do the same join. One home, one join, nothing to sever (D11).
 *
 * BUILT FROM THE CODE, NEVER FROM `PostResult.message`. The closed union is the whole
 * redaction argument — there is no parameter here through which a Slack response body
 * could travel — and it is the same belt-and-braces the first-run routes already apply
 * when they read the table rather than echoing the poster's own text.
 */
export function deliveryFailureSentence(code: PostFailureCode): string {
  const fact = POST_FAILURE_MESSAGES[code];
  const clause = DELIVERY_LANE_FAILURE_CLAUSE[code];

  return clause === null ? fact : `${fact} ${clause}`;
}

/**
 * Everything `packages/core`'s Slack renderer needs from this module, bundled so the
 * call site is one import rather than four.
 *
 * The renderer declares the shape it requires structurally (`DeliveryVocabulary` in
 * `packages/core/src/delivery/slack-message.ts`), `packages/shared` cannot import it,
 * because the dependency arrow is `core -> shared` and never the reverse.
 */
export const DELIVERY_VOCABULARY = {
  nothingTodayLead: NOTHING_TODAY_LEAD,
  nothingToday: NOTHING_TODAY_REASON_MESSAGES,
  noRate: NO_RATE_SENTENCE,
} as const;

/**
 * Every fixed customer-facing string in this module, in one array, so the plain-English
 * audit is total rather than best-effort: a constant added here and not registered
 * below is caught by the audit's own completeness test instead of quietly escaping
 * review.
 *
 * Deduplicated, because `NOTHING_TODAY_LEAD` deliberately appears both as its own
 * constant and as a member of `DELIVERY_DECISION_MESSAGES`, one sentence, two reachable
 * names, and the audit scans it once.
 */
export const ALL_DELIVERY_MESSAGES: readonly string[] = [
  ...new Set(
    [
      NOTHING_TODAY_LEAD,
      NO_RATE_SENTENCE,
      ...Object.values(DELIVERY_DECISION_MESSAGES),
      ...Object.values(NOTHING_TODAY_REASON_MESSAGES),
      ...Object.values(DELIVERY_STATUS_MESSAGES),
      ...Object.values(RESIDUAL_PII_KIND_MESSAGES),
      ...Object.values(POST_FAILURE_MESSAGES),
      // The lane's clauses are customer-facing sentences like any other, and they are
      // scanned as themselves rather than only as half of a composed one — a composed
      // sentence is not a fixed constant and the audit is a scan over fixed constants.
      ...Object.values(DELIVERY_LANE_FAILURE_CLAUSE),
    ].filter((message): message is string => message !== null),
  ),
];
