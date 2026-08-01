// The three places a candidate can be refused, and the one place a floor rung is
// assembled.
//
// Each of these wraps a decision that is itself pure (a predicate, a hash, a template
// render) in the one thing that keeps a per-candidate fault from costing a whole
// project its check: a catch that returns a value instead of throwing, and a log line
// that says what was refused and why.
//
// That is the shared property worth grouping them by. None of them touches a
// repository, a port or a clock; all of them take a logger, and all of them answer
// `null`/`false` where a lesser design would throw.
import type { CandidateFinding, FloorSummary, FloorSummarySource } from "@growthmind/core";
import { SIGNATURE_TUPLE_VERSION, renderFloorSummary } from "@growthmind/core";
import { computeFindingSignature } from "@growthmind/db";
import { describeError, isNormalisedUrlPath } from "@growthmind/shared";

import type { AnalysisLogger, CallAttribution, CandidateAction, CandidateIdentity } from "./types";

/**
 * The deterministic floor, or `null` if the floor itself refuses.
 *
 * `renderFloorSummary` throws by design rather than guessing. On a surface that is not
 * already normalised, on a `counts` arity that disagrees with the detector's declared
 * roles, on a template it cannot fully resolve. Its own header hands the isolation half
 * forward by name: "one refused candidate must not abort a whole run … it belongs to
 * whatever eventually calls this". This is that caller, and this function is where the
 * obligation is discharged.
 *
 * Fail direction: the candidate is refused, loudly, and no row is written for it. Both
 * alternatives are worse. Persisting the numbers under one of the `floor_*` sentences
 * would state "This shows the numbers on their own" over text carrying no numbers. A
 * false claim about what the reader is looking at, drawn from a sentence written for a
 * different cause. Authoring a replacement sentence here would put a customer-facing
 * string outside `@growthmind/shared`, which is the one home it may have. A gap
 * somebody notices in the log is the honest answer, and it is the direction the floor
 * itself already chose for every refusal above.
 *
 * The message names the signature and the cause, never the candidate. A refusal's own
 * text can name a page path or a count, and neither is a fact about this codebase.
 */
export function floorTextFor(
  signature: string,
  candidate: CandidateFinding,
  source: FloorSummarySource,
  logger: AnalysisLogger,
): FloorSummary | null {
  try {
    return renderFloorSummary({ candidate, source });
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${signature} could not be written up even without a model, so nothing was recorded for it — ${describeError(error)}`,
    );
    return null;
  }
}

/**
 * The surface gate (security audit). `false` refuses the candidate outright, before
 * the ladder starts.
 *
 * What it answers. `CandidateFinding.surface` is only `z.string.min`, so a raw url
 * path can arrive carrying a live password-reset token or an email address in a
 * segment. This lane has two egress points for that value and both are irreversible:
 * `render` hands it to a third party, and `persist` writes it to a permanent column.
 * Product decisions, forbid PII in the event stream, and neither egress can be walked
 * back once taken.
 *
 * Why it is here and not lower. The check itself is not new,
 * `assertNormalisedSurfaceForSignature` in
 * `db/src/services/signature-ledger.service.ts` was added by an earlier audit for this
 * exact reason. But in this lane it ran at `recordIdentity`, which is after both egress
 * points, and its throw is swallowed there by design. A correct check placed after the
 * thing it protects is an inert check. So the predicate is asked once, at the top,
 * where refusing still costs nothing.
 *
 * Fail direction: Withhold. `isNormalisedUrlPath` answers `false` on any doubt, and the
 * answer to doubt about a value that may be a secret is to not send it. The bound on
 * that is the identity case. An already-normalised path is a no-op through the
 * normaliser, so "refuse on doubt" cannot degrade into "refuse on everything";
 * `packages/shared/__tests__/sessions/url-path.test.ts` pins the near-miss controls,
 * and W13 pins this lane's own fixtures.
 *
 * A refusal is not a degradation. No claim is taken, no call is made, no row is
 * written, no `floor_*` sentence is chosen and the run is not failed, one candidate the
 * gate refused must not cost this project every other candidate (isolation). It is
 * counted, so the refusal is visible rather than silent.
 *
 * The message names the position and the cause, never the surface. The offending value
 * IS the suspected secret, and a log line is a third place it would then live. It
 * cannot name a signature either: this gate stands before the derivation, precisely
 * because deriving an identity from a surface that may be a secret is one of the two
 * egress points it exists to prevent (`identityFor` hashes it into a permanent value).
 * The candidate's position in the lane is what remains. Enough to tell two refusals in
 * one tick apart, and a fact about this walk rather than about somebody's product.
 */
export function surfaceIsSafeToSend(
  position: number,
  projectId: string,
  candidate: CandidateFinding,
  logger: AnalysisLogger,
): boolean {
  if (isNormalisedUrlPath(candidate.surface)) return true;

  logger.error(
    `analysis tick: candidate ${String(position)} of project ${projectId} arrived with a page path that is not in the form this product stores, so it was not sent to a model, not written down, and nothing was recorded for it`,
  );
  return false;
}

/**
 * The finding's identity, derived once per candidate. `null` refuses the candidate.
 *
 * No new hashing. `computeFindingSignature` (`@growthmind/db`, which composes
 * `signatureTuple` from `@growthmind/core` and `sha256Hex`) is the one producer of a
 * signature in this product, and this function does nothing but call it and pair the
 * answer with the tuple version that produced it. A second composition of those two
 * pieces (here or anywhere) would be a second home for identity, and two homes for one
 * identity is the fork every guarantee in this lane hangs off avoiding.
 *
 * Why the walker derives it rather than receiving it. The walker is the consumer: it
 * claims the cap on this value, reads back a prior finding on this value, and persists
 * on this value. A key handed in by the lane source would be a wire between an unbuilt
 * producer and three consumers, and a wire nobody can drive end to end is a wire that
 * is already broken. Deriving it here leaves nothing to sever.
 *
 * Why it is derived from content and not from position. An ordinal, or a tick-instant
 * prefix, mints a fresh identity on every tick: the cap's unique index would match
 * nothing and a lifetime ceiling would silently become a per-tick one, while
 * `findBySignature`'s reuse rung never hit. Content derivation is what makes "one claim
 * per distinct problem, for the lifetime of this project" a property of the schema
 * rather than of a comment.
 *
 * Fail direction: Refuse this candidate, never abort the run. `computeFindingSignature`
 * throws on a surface that is not already its own normalised form.
 * `surfaceIsSafeToSend` refuses exactly those candidates one step earlier, so this
 * throw is unreachable today. It is caught anyway, because a per-candidate fault that
 * travels as a throw is a fault that costs this project every candidate after it. The
 * message names the cause and the position, never the surface, for
 * `surfaceIsSafeToSend`'s reason.
 */
export function identityFor(
  position: number,
  projectId: string,
  candidate: CandidateFinding,
  logger: AnalysisLogger,
): CandidateIdentity | null {
  try {
    return {
      signature: computeFindingSignature({
        projectId,
        surface: candidate.surface,
        symptomClass: candidate.finalClass,
        evidenceShape: candidate.evidenceShape,
      }),
      signatureVersion: SIGNATURE_TUPLE_VERSION,
    };
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${String(position)} of project ${projectId} could not be given a permanent identity, so nothing was claimed, sent or written for it — ${describeError(error)}`,
    );
    return null;
  }
}

/** One floor rung, assembled. `floor.source` is carried through exactly as the renderer
 * returned it. This never re-states the cause it asked for. */
export function floorAction(
  floor: FloorSummary,
  attribution: CallAttribution,
  identity: CandidateIdentity,
): CandidateAction {
  return {
    kind: "persist",
    identity,
    summary: {
      summarySource: floor.source,
      headline: floor.headline,
      context: floor.context,
      attribution,
    },
  };
}
