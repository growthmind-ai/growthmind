import type { FindingEvidence } from "@growthmind/shared";

import type { EvidenceSignal } from "../evidence/signals";

const NOT_IMPLEMENTED = "finding-evidence: toFindingEvidence is not implemented";

export function toFindingEvidence(signals: readonly EvidenceSignal[]): readonly FindingEvidence[] {
  void signals;
  throw new Error(NOT_IMPLEMENTED);
}
