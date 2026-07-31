// EVERY fixed customer-facing string the delivery lane produces lives here
// (O-007), following the one-home rule already applied at
// `../session-source/messages.ts:1-24`, `../summary/messages.ts:1-7` and
// `../signatures/messages.ts:1-14`.
//
// One home, for the same three reasons those files give. (a) The plain-English
// audit in `__tests__/delivery/messages.test.ts` is a single-file review rather
// than a repo sweep. (b) The Slack renderer in
// `packages/core/src/delivery/slack-message.ts` IMPORTS these rather than
// re-authoring them, so there is no second copy to drift and no wire between a
// producer and a consumer to sever (D11). (c) A string that reaches a founder is
// reviewable as English, in one place, by somebody who has never read the code.
//
// ── HOW THE RENDERER REACHES THESE ──────────────────────────────────────────
// `@growthmind/shared` exposes exactly ONE entry point (its `package.json`
// `exports` map is `{ ".": "./src/index.ts" }`), so `packages/core` cannot deep
// import this module — it receives `DELIVERY_VOCABULARY` below as a REQUIRED
// argument. Required, and typed as a TOTAL `Record` keyed by the same closed
// union declared in `./types.ts`, so the two ends cannot disagree about which
// members exist: a member added there without a sentence here is a compile
// error on this file, and a caller that forgets the argument is a compile error
// at the call site. That is the D11 mitigation for a value one package computes
// and another consumes — the key set is not hand-passed, it is the union.
//
// ── HOUSE RULES THESE STRINGS OBEY, each asserted by a named test ───────────
//   - **No product jargon.** The banned list is imported from
//     `../signatures/messages.ts` — ONE vocabulary, not two, which is what
//     `packages/core/src/counts/measured-count.ts:30` requires of this sprint.
//   - **A session is never a person.** Identity stitching does not exist in
//     this product (`measured-count.ts:60-69`), so no string here says people,
//     users, customers or visitors. "3 of 40" means 3 of 40 SESSIONS, and a
//     sentence sitting beside that count may not quietly re-label it.
//   - **A sentence keyed by a lane state alone asserts only what that state
//     establishes.** `nothing_today` says we have nothing to send; it never
//     says the product is healthy. `failed` says we could not post; it never
//     says the finding went away. This is O-004's paid-for failure, and the
//     same rule `../signatures/messages.ts:17-30` states.
//   - **`null` where a state speaks for itself.** A delivered finding IS the
//     message; a `posted` row's evidence is the post. Inventing a sentence for
//     either would be a claim nothing established, so those members are `null`
//     — explicitly, never `""` and never a placeholder.
//
// This module deliberately re-exports NOTHING from `../signatures/messages.ts`.
// `FORBIDDEN_PRODUCT_JARGON` is imported by the AUDITS that scan these strings,
// not by the strings themselves — and a re-export here would give one list two
// names in the package barrel, which is how a second list starts.
import type { PostFailureCode } from "./poster";
import type {
  DeliveryDecision,
  DeliveryStatus,
  NothingTodayReason,
  ResidualPiiKind,
} from "./types";

/**
 * The lead sentence of a nothing-today post, kept as its own constant because
 * the renderer needs it as a `string` — reading it out of the `string | null`
 * map below would need a non-null assertion at every call site.
 *
 * MAY assert: we looked, and we are choosing not to send anything.
 * MAY NOT assert: that the product is fine, that nothing went wrong, or that
 * there is nothing to find — none of which a decision to stay quiet can know.
 */
export const NOTHING_TODAY_LEAD =
  "We looked at what happened in your product, and we are not sending you anything today.";

/**
 * The scheduler's decision, in the customer's words.
 *
 * `Record<DeliveryDecision, string | null>` is total by construction: adding a
 * member to `deliveryDecisionSchema` without a sentence here is a compile
 * error, not `undefined` rendered into Slack (D9).
 */
export const DELIVERY_DECISION_MESSAGES: Record<DeliveryDecision, string | null> = {
  // A delivered finding speaks for itself — the message IS the finding. A
  // preamble saying "we are sending you something" is a sentence about us
  // rather than about the product, and it costs a line of the reading budget.
  deliver: null,

  nothing_today: NOTHING_TODAY_LEAD,
};

/**
 * Why today is a quiet day. These are the DISTINGUISHABLE zeros
 * (`./types.ts:35-43`): "you still owe us an answer", "we looked and nothing
 * was solid enough", and "we are pacing ourselves" are three different facts
 * and must never read as one sentence.
 */
export const NOTHING_TODAY_REASON_MESSAGES: Record<NothingTodayReason, string> = {
  // MAY: something we already sent is still waiting on an answer, and that is
  // deliberate — one open thing at a time.
  // MAY NOT: that nothing else was found. We stopped looking for a second
  // thing to send; we did not establish there was none.
  one_already_open:
    "The last thing we sent is still waiting on an answer, and we only keep one of those open at a time. Once it is answered we will move on to the next one.",

  // MAY: we looked, and nothing cleared the bar we set before we will say
  // anything.
  // MAY NOT: that the product is fine, or that nothing went wrong — a bar we
  // did not clear is a statement about our own confidence.
  no_findings_ready:
    "We checked what happened and nothing was solid enough for us to put in front of you yet. We would rather stay quiet than send you something we cannot stand behind.",

  // MAY: we are pacing on purpose, and that is not a fault.
  // MAY NOT: that there is nothing left to send — that is exactly what a spent
  // budget cannot tell us, and reading it that way would make a quiet product
  // out of a busy one (the SAC-10 shape at `../summary/messages.ts:95-102`).
  budget_spent:
    "We have already sent everything we will send for now. Nothing is wrong — we hold back on purpose so that what does arrive is worth reading.",
};

/**
 * Where a delivery attempt got to. Every exit path records `posted` or `failed`
 * (`./types.ts:57-63`, D8), so these sentences are the ONLY thing standing
 * between a stuck row and a founder who thinks we went silent.
 */
export const DELIVERY_STATUS_MESSAGES: Record<DeliveryStatus, string | null> = {
  // Transparency over silence: work that is in flight says so
  // (`.claude/rules/event-transparency.md`).
  pending: "We are posting this to Slack now.",

  // The post itself is the evidence. Nothing to add.
  posted: null,

  // MAY: we could not post it, and the finding is untouched.
  // MAY NOT: that the finding is gone, wrong, or withdrawn — a delivery
  // failure is a fact about Slack, not about the product.
  failed:
    "We could not get this into Slack. Nothing about what we found has changed, and we will try again.",
};

/**
 * What we tell a founder when the last check before posting found something
 * that looks like personal data in generated text.
 *
 * Keyed by WHAT IT IS, never by the pattern that found it, and the sentence
 * NEVER quotes the match — echoing it would copy the personal data into the
 * very place we refused to send it (`./types.ts:75-84`).
 *
 * MAY assert: what the shape looked like, and that we held the post back.
 * MAY NOT assert: that it definitely IS personal data. This gate fails closed
 * on doubt by design (`packages/core/src/delivery/residual-pii.ts:14-27`), so
 * a sentence claiming certainty would be wrong on exactly the cases the gate
 * exists for.
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
 * The zero-denominator sentence (ES-7,
 * `packages/core/src/counts/measured-count.ts:44-50`).
 *
 * A window where every session was set aside is a REAL, reportable state, not
 * an error and not a missing number. It reaches the founder as this sentence
 * and never as "0%", which would claim we measured something and found none of
 * it — the opposite of what happened.
 */
export const NO_RATE_SENTENCE =
  "Every session we looked at was set aside, so there is no share to report.";

/**
 * What to tell a customer when one POST ATTEMPT failed, keyed by mechanism.
 *
 * Distinct from `DELIVERY_STATUS_MESSAGES`, which speaks at ROW level ("we
 * could not get this into Slack"). These speak at ATTEMPT level — which of four
 * different things someone has to do about it — which is the whole reason
 * `postFailureCodeSchema` splits four ways instead of one.
 *
 * They live HERE, not beside the Slack adapter that authored them, because this
 * module is the delivery lane's one home and `ALL_DELIVERY_MESSAGES` below is
 * the plain-English audit. `signatures/messages.ts` shipped standalone with its
 * own audit, but explicitly as the FALLBACK for when the aggregate's home was
 * contested; this one is not contested, so the same precedent says join it. Four
 * customer-facing sentences sitting outside the aggregate is exactly the drift
 * the aggregate exists to prevent.
 *
 * House rules each obeys, beyond the module header's:
 *   - Every one says the finding itself is untouched. A delivery failure is a
 *     fact about Slack, never a fact about what we found — and none of them
 *     claims the product is fine or that the finding has gone away.
 *   - Each names a DIFFERENT next step. Two identical sentences would throw
 *     away the distinction the port paid four codes for.
 */
export const POST_FAILURE_MESSAGES: Record<PostFailureCode, string> = {
  call_failed:
    "We could not get this into Slack just now. Nothing about what we found has changed, and we will try again.",

  rejected:
    "Slack would not accept this message as we built it, so it has not arrived. Sending the same thing again would not help. Nothing about what we found has changed.",

  not_authorised:
    "Slack is no longer letting us post on your behalf, so someone will need to reconnect it before anything can arrive. Nothing about what we found has changed.",

  channel_unavailable:
    "We could not post to the channel that was chosen — it may have been archived or deleted, or we may no longer be in it. Someone will need to pick another one. Nothing about what we found has changed.",
};

/**
 * Everything `packages/core`'s Slack renderer needs from this module, bundled
 * so the call site is ONE import rather than four.
 *
 * The renderer declares the shape it requires structurally
 * (`DeliveryVocabulary` in `packages/core/src/delivery/slack-message.ts`) —
 * `packages/shared` cannot import it, because the dependency arrow is
 * `core -> shared` and never the reverse.
 */
export const DELIVERY_VOCABULARY = {
  nothingTodayLead: NOTHING_TODAY_LEAD,
  nothingToday: NOTHING_TODAY_REASON_MESSAGES,
  noRate: NO_RATE_SENTENCE,
} as const;

/**
 * Every fixed customer-facing string in this module, in one array, so the
 * plain-English audit is TOTAL rather than best-effort: a constant added here
 * and not registered below is caught by the audit's own completeness test
 * instead of quietly escaping review.
 *
 * Deduplicated, because `NOTHING_TODAY_LEAD` deliberately appears both as its
 * own constant and as a member of `DELIVERY_DECISION_MESSAGES` — one sentence,
 * two reachable names, and the audit scans it once.
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
    ].filter((message): message is string => message !== null),
  ),
];
