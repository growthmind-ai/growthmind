// Failure mapping at the model boundary (O-011, AD-17, FR-M2), built exactly
// the way `../slack/errors.ts` is built: the vendor's error is read ONLY to
// select a code, and the sentence a human eventually reads comes from a fixed
// table of hand-written strings.
//
// ── WHAT THIS FILE DISCHARGES ───────────────────────────────────────────────
// `packages/shared/src/summary/types.ts:146-151` and `:199-201` hand this
// adapter an INHERITED OBLIGATION, flagged independently by two audits (ESC-9):
// the vendor's own error text must NEVER surface verbatim on
// `summaryRenderResultSchema`'s failure arm. An Anthropic SDK error message can
// carry a request id, an org id, an api-key tail, or a raw url, and
// `message: z.string()` accepts every byte of it silently. The schema cannot
// enforce this. This file does.
//
// ── THE GUARANTEE IS STRUCTURAL, NOT A SCRUB ────────────────────────────────
// `mapSummaryError` returns a `SummaryFailureCode` and nothing else, and
// `summaryFailure` takes a closed union plus a model id and a token count —
// there is NO vendor-text parameter anywhere in this module's surface. So there
// is no expression by which a byte of the SDK's response could reach a returned
// `message`, whatever the response contains. A scrubber can be defeated by an
// unanticipated pattern; a missing parameter cannot. Same argument, same shape,
// as `../slack/errors.ts:173-183`.
//
// ── WHY THE SENTENCES LIVE HERE AND NOT IN `shared` ─────────────────────────
// Unlike the Slack lane, whose sentences belong to
// `packages/shared/src/delivery/messages.ts` because that module is the
// delivery lane's one home and the place its plain-English audit scans, these
// two sentences are THIS PACKAGE'S OWN — they describe the adapter's own
// mechanism failures, not a lane's customer-facing vocabulary, and
// `__tests__/anthropic/errors.test.ts` pins them here (A6/A7 assert the message
// is drawn from `SUMMARY_FAILURE_MESSAGES` verbatim). The redaction guarantee
// is untouched by where they are written; it rests only on the signature below.
//
// ── ROUTING IS `isInstance`, NEVER `instanceof` (AD-17) ─────────────────────
// Recorded at `__tests__/anthropic/probe.test.ts:146-152`: `isInstance` is the
// only check documented to survive a workspace/bundling boundary where two
// copies of `ai` could exist. `instanceof` happens to work in-process today,
// which is precisely what makes it a trap.
import { NoObjectGeneratedError } from "ai";

import { summaryFailureCodeSchema } from "@growthmind/shared";
import type { SummaryFailureCode, SummaryRenderResult, SummaryUsage } from "@growthmind/shared";

/**
 * The sentences. One per member of the closed union, total by construction —
 * a `Record<SummaryFailureCode, string>` makes a missing member a compile
 * error, which matters because an absent sentence would surface as `undefined`
 * on a customer-facing field.
 *
 * Both are ABSENCE statements about the written explanation and say nothing
 * about the finding itself: the numbers are identical whichever applies. No
 * vendor name, no error class, no request detail — and none could be added by
 * accident, because nothing in this module has access to any.
 */
export const SUMMARY_FAILURE_MESSAGES: Record<SummaryFailureCode, string> = {
  /** The call completed; what came back was not readable as an explanation. */
  output_invalid:
    "We could not read the written explanation that came back, so we left it out. The numbers are unaffected.",
  /** The call itself did not complete — transport, auth, rate limit, timeout. */
  call_failed:
    "We could not generate a written explanation this time, so we left it out. The numbers are unaffected.",
};

/**
 * Where an error we cannot classify lands.
 *
 * `call_failed`, and the direction is chosen deliberately (D10 — a
 * classifier's misses matter more than its hits). `call_failed`'s sentence
 * claims only that the attempt did not go through, which is exactly what an
 * unrecognised error establishes. `output_invalid` claims something came back
 * and was unreadable — asserting that on an error we could not classify would
 * be describing a mechanism we have no evidence occurred. Either way the lane
 * degrades to the deterministic floor, so the cost of a miss is a slightly
 * less precise debugging signal, never a wrong customer-facing claim.
 */
export const UNCLASSIFIED_SUMMARY_ERROR_CODE: SummaryFailureCode = "call_failed";

/**
 * Maps whatever the SDK threw onto the mechanism the caller can act on.
 *
 * READS ONLY THE CLASS. The error's `message`, `text`, `cause` and `response`
 * are never inspected — not merely as a redaction measure but because routing
 * on text is unstable by construction (a vendor rewording a message would
 * silently reclassify a whole failure mode), and a mapper that reads the text
 * is one refactor away from returning it. `errors.test.ts` A7 pins this: two
 * errors of the same class with different messages must map identically.
 *
 * The parameter is `unknown` because a thrown non-`Error` — a string, a plain
 * object, `undefined`, `null` — is a real shape at a vendor boundary and must
 * land somewhere named rather than crash the caller.
 *
 * NOTE THE RETURN TYPE. This function cannot leak vendor text, because it does
 * not return text.
 */
export function mapSummaryError(error: unknown): SummaryFailureCode {
  // A schema violation and a missing object are the SAME class in the SDK
  // (probe.test.ts:159-175) and both are shape failures: the call completed,
  // and what came back could not be read as the expected shape.
  if (NoObjectGeneratedError.isInstance(error)) {
    return "output_invalid";
  }
  return UNCLASSIFIED_SUMMARY_ERROR_CODE;
}

/** Arguments to the ONE failure builder. Note what is absent: there is no
 * parameter here through which an error, a message, a response body or a url
 * could travel, so no caller can thread vendor text in — not even by trying. */
export interface SummaryFailureArgs {
  readonly code: SummaryFailureCode;
  /** A failed call still addressed a model. */
  readonly resolvedModelId: string;
  /** A failed call may still have been metered. Fields the SDK did not report
   * stay `undefined`, never `0` (FR-M9). */
  readonly usage: SummaryUsage;
}

/**
 * The ONLY way this package builds a failed `SummaryRenderResult`.
 *
 * `code` is validated rather than trusted: it is the one field that reaches a
 * persisted column, and a value outside the union would defeat the `Record`
 * lookup and yield an `undefined` message. An unparseable code falls back to
 * the safe default for the same reason `mapSummaryError` does.
 */
export function summaryFailure(
  args: SummaryFailureArgs,
): Extract<SummaryRenderResult, { ok: false }> {
  const parsed = summaryFailureCodeSchema.safeParse(args.code);
  const code: SummaryFailureCode = parsed.success ? parsed.data : UNCLASSIFIED_SUMMARY_ERROR_CODE;

  return {
    ok: false,
    code,
    message: SUMMARY_FAILURE_MESSAGES[code],
    resolvedModelId: args.resolvedModelId,
    usage: args.usage,
  };
}
