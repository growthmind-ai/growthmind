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

export {
  canonicalJson,
  type CanonicalValue,
  type CanonicalObject,
} from "./serialise/canonical-json";

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

export { analysedSessions, type AnalysedSessions } from "./detect/analysed";
export { detectFunnelDropoff } from "./detect/funnel-dropoff";
export { detectErrorEvent } from "./detect/error-event";
export { NOT_BUILT_DETECTORS, type NotBuiltDetector } from "./detect/not-built";

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

export {
  assembleCandidates,
  type AssembledCandidates,
  type RejectedCandidate,
} from "./findings/assemble";
export { confidenceBasisForPass } from "./evidence/predicates";

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

export {
  COUNT_ROLES,
  IMPACT_ROLE,
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

export {
  modelSummaryOutputSchema,
  splitSentences,
  joinSentences,
  guardModelText,
  type ModelSummaryOutput,
  type GuardedSacId,
  type GuardRefusal,
  type GuardVerdict,
  type SacOffence,
} from "./summary/output-schema";

export {
  scanResidualPii,
  isCleanForDelivery,
  type ResidualPiiFinding,
  type ResidualPiiScan,
} from "./delivery/residual-pii";
export {
  DELIVERY_BUDGET_PER_WEEK,
  DELIVERY_CLAIM_TTL_MS,
  deliveryClaimsExpireBefore,
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
  type SlackTextBlock,
  type SlackActionsBlock,
  type SlackAction,
  type SlackMessage,
} from "./delivery/slack-message";
export { toBlockKit } from "./delivery/block-kit";

export {
  renderFixSpec,
  isCodeShaped,
  fixSpecSchema,
  fixSpecInputSchema,
  CODE_SHAPED_MARKERS,
  FIX_SPEC_EVIDENCE_TEMPLATES,
  FIX_SPEC_NO_EVIDENCE_TEMPLATE,
  FIX_SPEC_BOUNDARY_TEMPLATES,
  FIX_SPEC_EVIDENCE_LIMIT_TEMPLATE,
  FIX_SPEC_COVERAGE_TEMPLATES,
  FIX_SPEC_ALL_TEMPLATES,
  type FixSpec,
  type FixSpecInput,
  type CodeShapedMarker,
} from "./fixes/fix-spec";

export {
  FIX_SPEC_PAYLOAD_VERSION,
  UnknownFixSpecPayloadVersionError,
  serialiseFixSpecInput,
  rehydrateFixSpecInput,
  toMeasuredCount,
  type FixSpecPayload,
} from "./fixes/rehydrate";
export { toFindingEvidence } from "./fixes/finding-evidence";

export {
  WORTH_WEIGHT_VERSION,
  UNWEIGHTED,
  surfaceWorth,
  unknownWorth,
  isSurfaceWorth,
  weightOfRole,
  surfaceWorthSchema,
  surfaceWorthInputSchema,
  type SurfaceWorth,
  type SurfaceWorthInput,
} from "./growth/surface-worth";

export {
  expectedValueOf,
  expectedValueOfCount,
  compareExpectedValue,
  type ExpectedValue,
} from "./growth/expected-value";

export {
  EMPTY_PROPOSAL_SCOPE,
  isProposableSurface,
  type ProposalVerdict,
  type ProposalScope,
} from "./growth/proposable";

export {
  ROLED_SURFACE_LIMIT,
  EMPTY_GROWTH_CONTEXT,
  growthContext,
  growthContextSchema,
  roledSurfaceSchema,
  worthOf,
  proposalScopeOf,
  type GrowthContext,
  type GrowthContextInput,
  type RoledSurface,
} from "./growth/context";

export {
  DERIVE_MIN_SESSIONS,
  DERIVE_MIN_SHARE,
  MONEY_SEGMENTS,
  proposeRole,
  deriveRoledSurfaces,
  surfaceObservationSchema,
  type SurfaceObservation,
  type RoleProposal,
  type DeriveInput,
} from "./growth/derive";

export {
  ICP_REFUSALS,
  admitIcpStatement,
  admitIcpBeliefs,
  type IcpRefusal,
  type IcpAdmission,
} from "./growth/icp-admission";
