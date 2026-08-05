import type {
  CandidateFinding,
  FindingText,
  FloorSummary,
  FloorSummarySource,
} from "@growthmind/core";
import {
  SIGNATURE_TUPLE_VERSION,
  renderFloorSummary,
  renderWithheldFloorSummary,
  reviewFindingText,
} from "@growthmind/core";
import { computeFindingSignature, describeHold } from "@growthmind/db";
import { describeError, isNormalisedUrlPath } from "@growthmind/shared";

import type { AnalysisLogger, CallAttribution, CandidateAction, CandidateIdentity } from "./types";

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

function persistAction(
  source: FloorSummarySource,
  text: Extract<FindingText, { held: false }>,
  attribution: CallAttribution,
  identity: CandidateIdentity,
): CandidateAction {
  return {
    kind: "persist",
    identity,
    summary: {
      summarySource: source,
      headline: text.headline,
      context: text.context,
      attribution,
    },
  };
}

// Withholding the words is not withholding the finding: the counts, the surface, the
// evidence shape and the signature ledger entry all survive a hold, and a row recorded
// with fixed-constant text can be written up again later.
function withheldAction(
  source: FloorSummarySource,
  attribution: CallAttribution,
  identity: CandidateIdentity,
): CandidateAction {
  const withheld = renderWithheldFloorSummary(source);
  const text = reviewFindingText({ headline: withheld.headline, context: withheld.context });

  return text.held ? { kind: "unrenderable" } : persistAction(source, text, attribution, identity);
}

export function floorAction(
  floor: FloorSummary,
  attribution: CallAttribution,
  identity: CandidateIdentity,
  logger: AnalysisLogger,
): CandidateAction {
  const text = reviewFindingText({ headline: floor.headline, context: floor.context });

  // Error, not info: below the floor there is nothing left to degrade to, and a
  // deterministic template that emits this is a defect in the template.
  if (text.held) {
    const hold = describeHold(text);
    logger.error(
      `analysis tick: candidate ${identity.signature} was written up without a model and the result still could not be shown (${hold.reason}/${String(hold.kind)}), so the numbers were recorded without any words beside them`,
    );
    return withheldAction(floor.source, attribution, identity);
  }

  return persistAction(floor.source, text, attribution, identity);
}
