import { observedStruggleCandidates } from "../evidence/observed-struggle";
import type { DetectorName, ThresholdRuleSet } from "../rules/types";
import { analysedSessions } from "./analysed";
import type { DetectorCorpus, DetectorResult } from "./types";

const DETECTOR: DetectorName = "observed_struggle";

export function detectObservedStruggle(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  const { coverage } = analysedSessions(corpus);

  return {
    detector: DETECTOR,

    connectionState: corpus.connectionState,
    coverage,
    candidates: observedStruggleCandidates(corpus, ruleSet),
  };
}
