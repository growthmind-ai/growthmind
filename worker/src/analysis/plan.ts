import type { CandidateFinding, FloorSummarySource } from "@growthmind/core";
import {
  guardModelText,
  joinSentences,
  modelSummaryOutputSchema,
  reviewFindingText,
  splitSentences,
} from "@growthmind/core";
import type {
  AnalysisRunRecord,
  AnalysisRunsRepo,
  FindingsRepo,
  SignatureLedgerService,
} from "@growthmind/db";
import { describeDriverError, describeHold, signatureHex } from "@growthmind/db";
import type { SummaryRenderResult } from "@growthmind/shared";
import { describeError } from "@growthmind/shared";

import { floorAction, floorTextFor, identityFor, surfaceIsSafeToSend } from "./gates";
import { summariseInputFor } from "./shapes";
import type { AnalysisLane, AnalysisLaneDeps, CallAttribution, CandidatePlan } from "./types";
import { NO_CALL } from "./types";

export async function planCandidate(
  deps: AnalysisLaneDeps,
  lane: AnalysisLane,
  runs: AnalysisRunsRepo,
  findings: FindingsRepo,
  run: AnalysisRunRecord,
  candidate: CandidateFinding,
  position: number,
  tickAt: Date,
  ledger: SignatureLedgerService,
): Promise<CandidatePlan> {
  if (!surfaceIsSafeToSend(position, lane.projectId, candidate, deps.logger)) {
    return { capExhausted: false, action: { kind: "refused" } };
  }

  const identity = identityFor(position, lane.projectId, candidate, deps.logger);
  if (identity === null) {
    return { capExhausted: false, action: { kind: "refused" } };
  }

  // Reuses the already-computed signature rather than the `CandidateFinding` overload —
  // recomputing here risks two separately-derived signatures for the same candidate
  // diverging if `SIGNATURE_TUPLE_VERSION` or any input changes mid-flight (D12).
  try {
    const decision = await ledger.consultSignature(
      lane.projectId,
      signatureHex(identity.signature),
    );
    if (decision.decision === "suppress") {
      return { capExhausted: false, action: { kind: "suppressed", reason: decision.reason } };
    }
  } catch (error) {
    // A thrown consult is not a resolved suppress decision (ADD Decision 3) — it is the
    // same shape as `identityFor`'s own failure mode, gated before spend, and lands in the
    // existing `refused` bucket rather than a new field on this outcome.
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} could not be checked against the dismissal ledger, so nothing was claimed, sent or written for it — ${describeDriverError(error)}`,
    );
    return { capExhausted: false, action: { kind: "refused" } };
  }

  const floorPlanFor = (
    source: FloorSummarySource,
    attribution: CallAttribution,
    capExhausted = false,
  ): CandidatePlan => {
    const floor = floorTextFor(identity.signature, candidate, source, deps.logger);
    return {
      capExhausted,
      action:
        floor === null
          ? { kind: "unrenderable" }
          : floorAction(floor, attribution, identity, deps.logger),
    };
  };

  if (deps.summariser === null) {
    return floorPlanFor("floor_no_key_configured", NO_CALL);
  }

  const summariser = deps.summariser;

  const claim = await runs.claimModelCall({
    projectId: lane.projectId,
    runId: run.id,
    signature: identity.signature,
    signatureVersion: identity.signatureVersion,
    projectCap: deps.projectCap,
    organizationCap: deps.organizationCap,
    at: tickAt,
  });

  if (!claim.claimed) {
    if (claim.reason === "cap_exhausted") {
      return floorPlanFor("floor_cap_exhausted", NO_CALL, true);
    }

    const existing = await findings.findBySignature(lane.projectId, identity.signature);
    if (existing !== null) {
      deps.logger.info(
        `analysis tick: candidate ${identity.signature} was already written up by an earlier run, so this tick left it alone`,
      );
      return { capExhausted: false, action: { kind: "reuse" } };
    }

    deps.logger.error(
      `analysis tick: candidate ${identity.signature} was claimed by an earlier run that recorded no finding, so it is being written up without one`,
    );
    return floorPlanFor("floor_model_call_failed", NO_CALL);
  }

  let result: SummaryRenderResult;
  try {
    result = await summariser.port.render(summariseInputFor(candidate));
  } catch (error) {
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} threw while being written up — ${describeError(error)}`,
    );
    return floorPlanFor("floor_model_call_failed", {
      attempted: true,

      resolvedModelId: summariser.resolvedModelId,
      usage: {},
    });
  }

  const attribution: CallAttribution = {
    attempted: true,
    resolvedModelId: result.resolvedModelId,
    usage: result.usage,
  };

  if (!result.ok) {
    const source: FloorSummarySource =
      result.code === "output_invalid" ? "floor_model_output_invalid" : "floor_model_call_failed";
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} has no written explanation — ${result.message}`,
    );
    return floorPlanFor(source, attribution);
  }

  const parsed = modelSummaryOutputSchema.safeParse({
    headline: result.headline,
    context: result.context,
  });
  if (!parsed.success) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} came back in a shape that could not be read as a written explanation`,
    );
    return floorPlanFor("floor_model_output_invalid", attribution);
  }

  const sentences = splitSentences(parsed.data.context);
  if (sentences === null) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} came back as prose that could not be checked one sentence at a time, so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  const verdict = guardModelText({
    candidate,
    headline: parsed.data.headline,
    context: joinSentences(sentences),
  });
  if (!verdict.ok) {
    const offences = verdict.offences
      .map((offence) => `${offence.sac}@${String(offence.element)}`)
      .join(", ");
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} had a written explanation that did not pass the accuracy check (${verdict.refusal}${offences === "" ? "" : `: ${offences}`}), so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  const text = reviewFindingText({ headline: parsed.data.headline, context: sentences });

  // `.held` alone, never the arm: a scan that throws has to leave by the same door as a
  // scan that hits, or the throw finds an unguarded path to the persist call.
  if (text.held) {
    const hold = describeHold(text);
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} had a written explanation still carrying something that must not be shown (${hold.reason}/${String(hold.kind)}), so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  return {
    capExhausted: false,
    action: {
      kind: "persist",
      identity,
      summary: {
        summarySource: "model_rendered",
        headline: text.headline,
        context: text.context,
        attribution,
      },
    },
  };
}
