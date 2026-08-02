import {
  BROKEN_PROOF_SIGNALS_V1,
  CHANGED_MIND_PROOF_SIGNALS_V1,
  CONFUSING_PROOF_SIGNALS_V1,
  INSTRUMENTATION_PROOF_SIGNALS_V1,
} from "../evidence/signals";
import type { ThresholdRuleSet } from "./types";

export const THRESHOLD_RULE_SET_VERSION = 2;

const RULE_SET_V1: ThresholdRuleSet = {
  version: 1,

  exceptionEventName: "$exception",

  passiveEventNames: ["$pageview", "$pageleave", "$identify", "$web_vitals"],

  vendorEventPrefix: "$",
  userInitiatedVendorEvents: ["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"],

  errorCorrelationWindowMs: 30_000,

  errorMinAffectedSessions: 3,

  funnelMinSessionsAtOrigin: 20,

  funnelMinDropoffSessions: 5,

  funnelDropoffRateThresholdPercent: 40,

  struggleRepeatedAttemptMin: 3,

  struggleMinStrugglingSessions: 3,

  instrumentationDropRatioPercent: 20,

  instrumentationMinExpected: 50,

  brokenProofSignals: BROKEN_PROOF_SIGNALS_V1,
  confusingProofSignals: CONFUSING_PROOF_SIGNALS_V1,

  changedMindProofSignals: CHANGED_MIND_PROOF_SIGNALS_V1,
  instrumentationProofSignals: INSTRUMENTATION_PROOF_SIGNALS_V1,
};

const RULE_SET_V2: ThresholdRuleSet = {
  ...RULE_SET_V1,
  version: 2,
};

export const THRESHOLD_RULE_SETS: ReadonlyMap<number, ThresholdRuleSet> = new Map([
  [1, RULE_SET_V1],
  [2, RULE_SET_V2],
]);

export const CURRENT_THRESHOLD_RULE_SET: ThresholdRuleSet = RULE_SET_V2;
