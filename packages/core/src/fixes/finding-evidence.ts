import { FINDING_EVIDENCE_MAX_ITEMS } from "@growthmind/shared";
import type { FindingEvidence } from "@growthmind/shared";

import type { EvidenceSignal } from "../evidence/signals";

// Every label below is a thing a detector observed — an event name or a surface. Findings
// also carry rendered prose in `context`; deriving an observation from a sentence would be
// inventing evidence, so nothing here reads it.
function evidenceFor(signal: EvidenceSignal): FindingEvidence {
  switch (signal.kind) {
    case "failure_correlated":
    case "failure_uncorrelated":
    case "instrumentation_rate_drop":
      return { kind: "event", label: signal.eventName, url: null };
    case "struggle":
    case "clean_exit":
      return { kind: "funnel_step", label: signal.surface, url: null };
  }
}

export function toFindingEvidence(signals: readonly EvidenceSignal[]): readonly FindingEvidence[] {
  const evidence: FindingEvidence[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    if (evidence.length === FINDING_EVIDENCE_MAX_ITEMS) break;

    const row = evidenceFor(signal);
    const identity = `${row.kind}:${row.label}`;
    if (seen.has(identity)) continue;

    seen.add(identity);
    evidence.push(row);
  }

  return evidence;
}
