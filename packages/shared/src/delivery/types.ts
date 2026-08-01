import { z } from "zod";

// The delivery lane's shapes. Zod is the single runtime source of truth, matching
// `../summary/types.ts` and `../signatures/types.ts`.
//
// Every union below is closed and total: no path in this lane may return `null` or
// `undefined` to mean one of these states. The same constraint the summary lane
// accepted. A nullable column may exist only where null is itself a fact, never as a
// stand-in for a state named here.
//
// Every member carries a comment stating what it means to a customer, not an engineer.
// `./messages.ts` turns the customer-visible ones into the sentence Slack would
// actually show, and the completeness audit in `__tests__/delivery/messages.test.ts`
// keeps the two files from drifting.

/**
 * What the scheduler decided to do this tick (FR: "one open finding + an explicit
 * nothing-today state").
 *
 * Two members, not one-plus-null: "we are sending you this" and "we looked and there is
 * nothing for you today" are both positive answers a customer is owed. Collapsing
 * `nothing_today` into an absent delivery would reproduce the defect
 * `analysisOutcomeSchema` exists to prevent. Silence that reads as either "all quiet"
 * or "it is broken", indistinguishably.
 */
export const deliveryDecisionSchema = z.enum([
  /** We have one thing worth telling you about, and we are posting it. */
  "deliver",
  /** We looked and there is nothing to send you right now. An explicit, postable state,
   * never an absence. */
  "nothing_today",
]);
export type DeliveryDecision = z.infer<typeof deliveryDecisionSchema>;

/**
 * Why a tick produced `nothing_today` rather than a delivery.
 *
 * These are the distinguishable zeros, in the same spirit as `analysisOutcomeSchema`'s
 * split of `no_candidates_passed_gate` from `no_sessions_to_analyse`. "You still owe us
 * an answer on the last one" and "your product was quiet" are different facts and must
 * never render as the same sentence.
 */
export const nothingTodayReasonSchema = z.enum([
  /** A finding we already sent is still waiting on a response, and we only ever have
   * one of those open at a time. */
  "one_already_open",
  /** We looked at what happened and nothing rose to the bar we require before we will
   * say anything. */
  "no_findings_ready",
  /** We already posted as much as we will post in this window. Nothing is wrong; we are
   * pacing ourselves on purpose. */
  "budget_spent",
]);
export type NothingTodayReason = z.infer<typeof nothingTodayReasonSchema>;

/**
 * Where a delivery attempt got to. The terminal states are `posted` and `failed`, and
 * every exit path must record one of them (`.claude/rules/event-transparency.md`): a
 * missed terminal write leaves a finding stuck `pending` forever, which reads to the
 * customer as silence and to the scheduler as "one already open". Permanently jamming
 * the lane.
 */
export const deliveryStatusSchema = z.enum([
  /** We have decided to post this and have not yet heard back from Slack. */
  "pending",
  /** Slack accepted it. */
  "posted",
  /** We could not post it. The plain-English reason travels on the row; the finding
   * itself is untouched and remains deliverable. */
  "failed",
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/**
 * A class of personal data the residual scanner refuses to let through
 * (`@growthmind/core`'s `scanResidualPii`).
 *
 * Keyed by what it is to a customer, never by the regex that found it. The scanner
 * reports the kind and the offset and never the matched text. Echoing it would copy the
 * personal data into logs and error messages, which is the same defect the signature
 * service's refusal path already guards against (`computeFindingSignature` never echoes
 * the offending surface).
 */
export const residualPiiKindSchema = z.enum([
  /** Looks like someone's email address. */
  "email_address",
  /** Looks like a phone number. */
  "phone_number",
  /** Looks like a payment card number. */
  "payment_card",
  /** Looks like a network address that can identify a person's connection. */
  "ip_address",
  /** Looks like a secret. An API key, token, or password. */
  "credential",
]);
export type ResidualPiiKind = z.infer<typeof residualPiiKindSchema>;

/** Every `ResidualPiiKind`, as a const tuple for exhaustiveness checks. */
export const RESIDUAL_PII_KINDS = [
  "email_address",
  "phone_number",
  "payment_card",
  "ip_address",
  "credential",
] as const satisfies readonly [ResidualPiiKind, ...ResidualPiiKind[]];

/** Every `NothingTodayReason`, as a const tuple. */
export const NOTHING_TODAY_REASONS = [
  "one_already_open",
  "no_findings_ready",
  "budget_spent",
] as const satisfies readonly [NothingTodayReason, ...NothingTodayReason[]];
