// The customer-facing English for a suppression decision (O-006, FR-P1-1).
//
// **Standalone by instruction, not by accident.** ADD §5 Wave 1 says to append
// these to the existing `ALL_CUSTOMER_FACING_MESSAGES` aggregate ONLY if that
// aggregate's home is unchanged and uncontested. It is contested: the aggregate
// lives in `../session-source/messages.ts` today, and O-005 is concurrently
// creating a second home for it at `../summary/messages.ts`. Joining either one
// now buys a rebase fight and, worse, a coin-flip about which aggregate the
// plain-English audit actually scans. So this map ships standalone WITH ITS OWN
// enumeration and plain-English audit (`__tests__/signatures/messages.test.ts`),
// which is the ADD's explicit fallback. When O-005 settles the aggregate's
// single home, one line adds `...Object.values(SUPPRESSION_REASON_MESSAGES)`
// there — the audit here stays regardless, so nothing is left unguarded in the
// meantime.
//
// House rules these strings obey, each asserted by a named test (the PRD's
// String Assertion Contract, which is O-004's number-one failure paid for):
//   - **A sentence keyed by ledger state alone NEVER asserts what was
//     observed.** We know what we presented; we do not know what a user hit.
//   - `dismissed` says a person made a decision — never that the underlying
//     problem is fixed or stopped happening.
//   - `already_delivered` asserts PRESENTATION ("we told you"), never
//     RECURRENCE ("it happened again").
//   - The two doubt reasons say something is unclear so nothing was posted —
//     they never claim health, and they never claim this IS a repeat.
//   - The two deliver reasons produce NO string at all. `null` is the honest
//     value: a delivered finding speaks for itself, and inventing a sentence
//     for it would be a claim nothing established.
//   - No product jargon: the words signature, ledger, suppression, policy,
//     candidate, dedup, hash appear in none of them (P-2 floor).
import type { SuppressionReasonCode } from "./types";

/**
 * Reason code → the sentence a customer may be shown, or `null` where the
 * decision was to deliver and no customer-facing string exists.
 *
 * `Record<SuppressionReasonCode, string | null>` is total by construction:
 * adding a member to `suppressionReasonCodeSchema` without adding its message
 * here is a compile error, not a `undefined` rendered to a founder (D9). The
 * enumeration test proves the same thing at runtime against the Zod enum, so
 * the guarantee survives a `Record` that someone later loosens.
 *
 * The rendering surface is O-007's, not this sprint's — these are the words,
 * not the layout.
 */
export const SUPPRESSION_REASON_MESSAGES: Record<SuppressionReasonCode, string | null> = {
  // MAY: a person decided, and it will not come back.
  // MAY NOT: that it is fixed, that it stopped, or who decided (the row is not
  // read here, so naming a person would be a claim we cannot support).
  dismissed:
    "Someone on your team marked this as not useful, so we are leaving it out from now on. You can change that if you want it back.",

  // MAY: that we reported this before.
  // MAY NOT: "it happened again" — we know what we sent you, not what anyone
  // ran into since.
  already_delivered: "We have already told you about this one, so we are not sending it again.",

  // A deliver decision. No customer-facing string exists, and none is invented.
  not_seen_before: null,
  seen_not_delivered: null,

  // MAY: that we are not certain this is new, so we held it back.
  // MAY NOT: that nothing happened, that the product is fine, or that this is
  // a repeat — we do not know any of those.
  unresolvable_ancestry:
    "We could not work out whether this is something we have told you about before, so we held it back rather than risk saying the same thing twice. Nothing was posted about it.",

  // Same doubt, different cause: this build has no reader for the form this
  // arrived in. Says what is unclear, claims nothing about the product.
  unknown_shape_version:
    "This came through in a form this version of Growthmind does not know how to read yet, so we could not tell whether it was new. Nothing was posted about it.",
};

/**
 * The strings above with the `null`s dropped — the exact set a plain-English
 * audit has to scan. Derived from the map rather than re-listed, so a message
 * cannot escape the audit by being added in one place and not the other.
 */
export const ALL_SUPPRESSION_REASON_MESSAGES: readonly string[] = Object.values(
  SUPPRESSION_REASON_MESSAGES,
).filter((message): message is string => message !== null);

/**
 * The words that must never reach a customer (PRD String Assertion Contract,
 * final row). Exported so the audit and any future aggregate share one list
 * instead of two that drift.
 */
export const FORBIDDEN_PRODUCT_JARGON = [
  "signature",
  "ledger",
  "suppression",
  "policy",
  "candidate",
  "dedup",
  "hash",
] as const;
