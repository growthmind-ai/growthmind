import { z } from "zod";

import type { EvidenceSignalKind } from "../evidence/signals";

export const findingClassSchema = z.enum([
  "broken",
  "confusing",
  "changed_mind",
  "instrumentation",
]);
export type FindingClass = z.infer<typeof findingClassSchema>;

export const detectorProposedClassSchema = z.enum(["broken", "confusing", "instrumentation"]);
export type DetectorProposedClass = z.infer<typeof detectorProposedClassSchema>;

export const detectorNameSchema = z.enum(["funnel_dropoff", "error_event", "observed_struggle"]);
export type DetectorName = z.infer<typeof detectorNameSchema>;

export type ThresholdRuleSet = {
  readonly version: number;
  readonly exceptionEventName: string;
  readonly passiveEventNames: readonly string[];

  readonly vendorEventPrefix: string;

  readonly userInitiatedVendorEvents: readonly string[];
  readonly errorCorrelationWindowMs: number;
  readonly errorMinAffectedSessions: number;
  readonly funnelMinSessionsAtOrigin: number;
  readonly funnelMinDropoffSessions: number;
  readonly funnelDropoffRateThresholdPercent: number;
  readonly struggleRepeatedAttemptMin: number;
  readonly struggleMinStrugglingSessions: number;
  readonly struggleRageClickMin: number;
  readonly struggleDeadClickMin: number;
  readonly struggleFieldAbandonedMin: number;
  readonly struggleFieldRefocusMin: number;
  readonly struggleScrollBackMin: number;
  readonly struggleObservedMinSessions: number;
  readonly instrumentationDropRatioPercent: number;
  readonly instrumentationMinExpected: number;
  readonly brokenProofSignals: readonly EvidenceSignalKind[];
  readonly confusingProofSignals: readonly EvidenceSignalKind[];
  readonly changedMindProofSignals: readonly EvidenceSignalKind[];
  readonly instrumentationProofSignals: readonly EvidenceSignalKind[];
};
