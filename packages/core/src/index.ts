// `@growthmind/core` — the product's own judgement and maths.
//
// `@growthmind/shared` means "shapes both sides of a wire agree on", which is
// why its zod-only rule reads as a rule rather than an accident. THIS package
// means "the product's own judgement": the T1 detectors, the evidence gate,
// measured counts, the threshold rule sets, and `evidence_shape`.
//
// TWO DEPENDENCIES, EVER: `@growthmind/shared` and `zod` (D-1). NO NODE
// BUILTIN IS IMPORTED ANYWHERE IN THIS PACKAGE — that is what makes FR-5's
// "no clock, no randomness" auditable by construction, and a test asserts it.
// The dependency arrow is `db -> core`, never `core -> db`.

// --- counts (D-8, D-7, FR-10, FR-7, BS-3) -----------------------------------
export {
  measuredCount,
  rateOf,
  isMeasuredCount,
  measuredCountSchema,
  measuredCountInputSchema,
  countBasisSchema,
  setAsideBasisSchema,
  type MeasuredCount,
  type MeasuredCountInput,
  type CountBasis,
  type SetAsideBasis,
  type Rate,
} from "./counts/measured-count";

// --- canonical serialisation (D-13) -----------------------------------------
export {
  canonicalJson,
  type CanonicalValue,
  type CanonicalObject,
} from "./serialise/canonical-json";

// --- rules (D-9, D-14, FR-8, FR-9, FR-11) -----------------------------------
export {
  findingClassSchema,
  detectorProposedClassSchema,
  detectorNameSchema,
  type FindingClass,
  type DetectorProposedClass,
  type DetectorName,
  type ThresholdRuleSet,
} from "./rules/types";
export {
  THRESHOLD_RULE_SET_VERSION,
  THRESHOLD_RULE_SETS,
  CURRENT_THRESHOLD_RULE_SET,
} from "./rules/thresholds";

// --- detect (D-2, D-3, D-4, D-5, D-17, D-18, FR-1, FR-2) --------------------
export {
  DETECTOR_CORPUS_MAX_SESSIONS,
  analysisWindowSchema,
  detectorCoverageSchema,
  type TimelineEvent,
  type SessionTimeline,
  type AnalysisWindow,
  type DetectorCoverage,
  type DetectorCorpus,
  type DetectorCandidate,
  type DetectorResult,
} from "./detect/types";
export { orderTimeline } from "./detect/order";
// FR-7 + D-3 in one call, and the ONE implementation of PL ruling 24. It is
// exported because a module that decides the denominator BOTH detectors report
// on must be visible to the FR-22 coverage gate — an unexported one is
// structurally exempt from the test that proves every pure function is covered,
// which is exactly how the two detectors diverged here in the first place.
export { analysedSessions, type AnalysedSessions } from "./detect/analysed";
export { detectFunnelDropoff } from "./detect/funnel-dropoff";
export { detectErrorEvent } from "./detect/error-event";
export { NOT_BUILT_DETECTORS, type NotBuiltDetector } from "./detect/not-built";

// --- evidence (D-10, D-11, D-19, FR-12, FR-13, FR-13B, FR-14, FR-19) --------
export {
  evidenceSignalSchema,
  evidenceSignalKindSchema,
  BROKEN_PROOF_SIGNALS_V1,
  CONFUSING_PROOF_SIGNALS_V1,
  CHANGED_MIND_PROOF_SIGNALS_V1,
  INSTRUMENTATION_PROOF_SIGNALS_V1,
  type EvidenceSignal,
  type EvidenceSignalKind,
} from "./evidence/signals";
export {
  PROOF_PREDICATE_VERSION,
  PROOF_PREDICATES,
  brokenProofSatisfied,
  confusingProofSatisfied,
  changedMindProofSatisfied,
  instrumentationProofSatisfied,
  type ProofPredicate,
} from "./evidence/predicates";
export {
  DOWNGRADE_PATH,
  evaluate,
  isReachableClass,
  proposedClaimSchema,
  type DowngradeDestination,
  type ProposedClaim,
  type GateOutcome,
} from "./evidence/gate";
export {
  GATE_REASON_MESSAGES,
  gateReasonCodeSchema,
  traceEntry,
  traceEntrySchema,
  downgradeTraceSchema,
  type GateReasonCode,
  type GateReasonTable,
  type TraceEntry,
  type DowngradeTrace,
} from "./evidence/trace";

// --- findings (D-12, FR-16, FR-17) ------------------------------------------
export {
  candidateFindingSchema,
  rankingInputsSchema,
  confidenceBasisSchema,
  type CandidateFinding,
  type RankingInputs,
  type ConfidenceBasis,
} from "./findings/candidate";
export {
  evidenceShape,
  EVIDENCE_SHAPE_VERSION,
  EVIDENCE_SHAPE_SERIALISERS,
  type EvidenceShapeInput,
  type EvidenceShapeSerialiser,
} from "./findings/evidence-shape";

// --- O-006 -------------------------------------------------------------------
export {
  signatureTuple,
  SIGNATURE_TUPLE_VERSION,
  SIGNATURE_TUPLE_SERIALISERS,
  type SignatureTupleInput,
  type SignatureTupleSerialiser,
} from "./findings/signature-tuple";
export {
  suppressionDecision,
  SUPPRESSION_POLICY_VERSION,
  SUPPRESSION_POLICIES,
  type LedgerRowState,
  type ResolvedLedgerState,
  type SuppressionDecision,
  type SuppressionPolicy,
} from "./findings/suppression-policy";

// --- O-005: the deterministic floor renderer ---------------------------------
//
// EXACTLY FOUR VALUES AND FOUR TYPES, and the shortness of this list is the
// decision rather than an oversight. `coverage.test.ts:164` makes every
// barrel-exported FUNCTION owe a mirroring `__tests__/<specifier>.test.ts` and
// a call by name — so `renderFloorSummary` and `resolveCounts` are exported
// precisely because `__tests__/summary/floor.test.ts` and
// `__tests__/summary/count-roles.test.ts` exist and call them.
//
// DELIBERATELY NOT EXPORTED: `substitute`, `placeholdersIn`, and all four
// scanners. Each would owe its own mirror file and would become a production
// surface with no production caller — the D11 dead wire this sprint exists not
// to add to. `substitute` has one caller inside the package and is asserted
// through the renderer's own suite; the scanners are test-local by design.
//
// NOTHING HERE IS CALLED IN PRODUCTION YET. No worker task, no service and no
// route invokes `renderFloorSummary`; exporting it is what lets the sprint that
// wires the lane import it without reopening this file.
export {
  COUNT_ROLES,
  resolveCounts,
  type CountRole,
  type ResolvedCounts,
} from "./summary/count-roles";
export { renderFloorSummary } from "./summary/floor";
export {
  floorSummarySourceSchema,
  type FloorSummary,
  type FloorSummarySource,
} from "./summary/types";

// --- O-007 -------------------------------------------------------------------
export {
  scanResidualPii,
  isCleanForDelivery,
  type ResidualPiiFinding,
  type ResidualPiiScan,
} from "./delivery/residual-pii";
export {
  DELIVERY_BUDGET_PER_WEEK,
  isDeliverable,
  compareDeliveryCandidates,
  decideDelivery,
  type DeliveryCandidate,
  type DeliveryLaneState,
  type ScheduleDecision,
} from "./delivery/schedule";
export {
  SLACK_MESSAGE_CHARACTER_BUDGET,
  SLACK_MESSAGE_LINE_BUDGET,
  SURFACE_PATH_BUDGET,
  HEADLINE_BUDGET,
  CONTEXT_BUDGET,
  TIGHT_CONTEXT_BUDGET,
  OBSERVATION_LABEL_BUDGET,
  MAX_OBSERVATIONS,
  TRUNCATION_MARKER,
  COHORT_NOUNS,
  describesPeople,
  renderCountSentence,
  renderSlackMessage,
  observationSchema,
  deliveredExplanationSchema,
  slackMessageInputSchema,
  type DeliveryVocabulary,
  type Observation,
  type DeliveredExplanation,
  type SlackMessageInput,
  type SlackBlock,
  type SlackMessage,
} from "./delivery/slack-message";
