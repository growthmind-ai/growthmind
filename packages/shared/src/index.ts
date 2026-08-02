export { serverEnvSchema, parseServerEnv, DEV_ENCRYPTION_KEY, type ServerEnv } from "./env";

export { describeError } from "./errors";

export {
  createLogger,
  loggerFromEnv,
  logger,
  jsonSink,
  prettySink,
  parseLogLevel,
  levelFromEnv,
  sinkFromEnv,
  setLogSink,
  serialiseFields,
  LOG_LEVELS,
  type Logger,
  type LogFields,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LoggerOptions,
} from "./logging";

export {
  tenantContextSchema,
  tenantResolutionInputSchema,
  type TenantContext,
  type TenantResolutionInput,
  type Membership,
} from "./tenancy/context";
export { resolveActiveOrganization } from "./tenancy/resolve-active-organization";
export { deriveTenantContext } from "./tenancy/derive-tenant-context";
export { deriveWorkspaceName } from "./tenancy/derive-workspace-name";

export {
  writeKeyKindSchema,
  originSchema,
  writeKeyMetadataSchema,
  type WriteKeyKind,
  type Origin,
  type WriteKeyMetadata,
} from "./write-keys/types";
export { WRITE_KEY_PREFIX, isWriteKeyFormat, hashWriteKeyMaterial } from "./write-keys/material";
export { originForKind, attributeWriteKey } from "./write-keys/attribution";

export {
  signUpSchema,
  signInSchema,
  workspaceNameSchema,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  type SignUpInput,
  type SignInInput,
  type WorkspaceName,
} from "./forms";

export {
  credentialAad,
  keyIdOf,
  encryptSecret,
  decryptSecret,
  ENVELOPE_VERSION,
  IV_BYTE_LENGTH,
  AUTH_TAG_BYTE_LENGTH,
  CREDENTIAL_KEY_BYTE_LENGTH,
  type CredentialKey,
  type DecryptFailureReason,
  type DecryptResult,
} from "./crypto/secret-box";
export {
  resolveCredentialKey,
  type CredentialKeyFailureReason,
  type CredentialKeyResolution,
} from "./crypto/credential-key";

export {
  sessionSourceKindSchema,
  sourceFailureCodeSchema,
  sourceFailureSchema,
  connectionHealthSchema,
  internalDomainProvenanceSchema,
  identityResolutionSchema,
  sessionSourceValidationSchema,
  sessionSourcePullRequestSchema,
  sourceSessionSchema,
  sourceEventSchema,
  sessionSourcePullResultSchema,
  connectionSummarySchema,
  connectionStateSchema,
  connectInputSchema,
  connectRefusalCodeSchema,
  connectRefusalSchema,
  connectResultSchema,
  pollRunStatusSchema,
  pollRunOutcomeSchema,
  type SessionSourceKind,
  type SourceFailureCode,
  type SourceFailure,
  type ConnectionHealth,
  type InternalDomainProvenance,
  type IdentityResolution,
  type SessionSourceValidation,
  type SessionSourcePullRequest,
  type SourceSession,
  type SourceEvent,
  type SessionSourcePullResult,
  type ConnectionSummary,
  type ConnectionState,
  type ConnectionStateStatus,
  type ConnectInput,
  type ConnectRefusalCode,
  type ConnectRefusal,
  type ConnectResult,
  type PollRunStatus,
  type PollRunOutcome,
} from "./session-source/types";
export {
  CONNECTION_STATE_MESSAGES,
  CONNECT_REFUSAL_MESSAGES,
  secondSourceRefusalMessage,
  EXCLUSION_REASON_LABELS,
  COUNTER_LABELS,
  COUNTER_WINDOW_STATEMENT,
  COUNTER_COMPLETENESS_STATEMENT,
  SOURCE_ABSENT_NOTICE,
  SOURCE_DEGRADED_NOTICE,
  expectedLagStatement,
  ALL_CUSTOMER_FACING_MESSAGES,
} from "./session-source/messages";

export { GATE_REASON_MESSAGES, type GateReasonKey } from "./gate/messages";

export {
  exclusionReasonSchema,
  type ExclusionReason,
  type SessionFacts,
  type ExclusionRuleSet,
} from "./exclusions/types";
export { FREE_MAIL_DOMAINS, isFreeMailDomain } from "./exclusions/free-mail";
export { emailDomainOf, inferInternalDomain } from "./exclusions/internal-domain";
export {
  matchesToken,
  HEADLESS_TOKENS,
  KNOWN_AGENT_TOKENS,
  CODING_AGENT_TOKENS,
} from "./exclusions/automation";
export {
  classifyExclusion,
  EXCLUSION_RULE_SET_VERSION,
  EXCLUSION_RULE_SETS,
  CURRENT_EXCLUSION_RULE_SET,
} from "./exclusions/classify";

export {
  deriveSessionKey,
  SESSION_GROUPING_VERSION,
  SESSION_BUCKET_MS,
  type SessionKeyInput,
} from "./sessions/grouping";
export {
  normaliseUrlPath,
  isNormalisedUrlPath,
  URL_PATH_NORMALISATION_VERSION,
} from "./sessions/url-path";
export {
  hashIdentityKey,
  deriveIdentityHmacKey,
  type IdentityHmacKey,
} from "./sessions/identity-key";

export {
  expectedLagSchema,
  setAsideBreakdownSchema,
  eventsSeenCounterSchema,
  type ExpectedLag,
  type SetAsideBreakdown,
  type EventsSeenCounter,
} from "./counter/types";
export {
  describeExpectedLag,
  POSTHOG_P90_RETRIEVAL_SECONDS,
  POSTHOG_MAX_RETRIEVAL_SECONDS,
} from "./counter/lag";

export {
  analysisRunStatusSchema,
  analysisOutcomeSchema,
  analysisStopReasonSchema,
  summarySourceSchema,
  summaryFailureCodeSchema,
  summaryUsageSchema,
  summaryRenderResultSchema,
  type AnalysisRunStatus,
  type AnalysisOutcome,
  type AnalysisStopReason,
  type SummarySource,
  type SummaryFailureCode,
  type SummaryUsage,
  type SummaryRenderResult,
} from "./summary/types";

export {
  ANALYSIS_RUN_STATUS_MESSAGES,
  ANALYSIS_OUTCOME_MESSAGES,
  ANALYSIS_STOP_REASON_MESSAGES,
  SUMMARY_SOURCE_MESSAGES,
  FLOOR_OBSERVATION_TEMPLATES,
  FLOOR_COUNT_TEMPLATES,
  FLOOR_CONFIDENCE_TEMPLATES,
  FLOOR_TIMEFRAME_TEMPLATE,
  FLOOR_NO_RATE_TEMPLATE,
  ALL_CUSTOMER_FACING_MESSAGES as SUMMARY_ALL_CUSTOMER_FACING_MESSAGES,
} from "./summary/messages";

export {
  suppressionReasonCodeSchema,
  ancestryReasonSchema,
  dismissalActionSchema,
  ANCESTRY_RESOLUTION_MAX_HOPS,
  ANCESTRY_REASONS,
  DISMISSAL_ACTIONS,
  type SuppressionReasonCode,
  type AncestryReason,
  type DismissalAction,
} from "./signatures/types";
export {
  SUPPRESSION_REASON_MESSAGES,
  ALL_SUPPRESSION_REASON_MESSAGES,
  FORBIDDEN_PRODUCT_JARGON,
} from "./signatures/messages";

export {
  deliveryDecisionSchema,
  nothingTodayReasonSchema,
  deliveryStatusSchema,
  residualPiiKindSchema,
  RESIDUAL_PII_KINDS,
  NOTHING_TODAY_REASONS,
  type DeliveryDecision,
  type NothingTodayReason,
  type DeliveryStatus,
  type ResidualPiiKind,
} from "./delivery/types";
export {
  NOTHING_TODAY_LEAD,
  DELIVERY_DECISION_MESSAGES,
  NOTHING_TODAY_REASON_MESSAGES,
  DELIVERY_STATUS_MESSAGES,
  RESIDUAL_PII_KIND_MESSAGES,
  NO_RATE_SENTENCE,
  DELIVERY_VOCABULARY,
  ALL_DELIVERY_MESSAGES,
} from "./delivery/messages";
export {
  postFailureCodeSchema,
  postResultSchema,
  isRetryablePostFailure,
  type PostFailureCode,
  type PostResult,
  type PostRequest,
  type DeliveryPoster,
} from "./delivery/poster";
export { POST_FAILURE_MESSAGES } from "./delivery/messages";

export {
  MCP_TOOL,
  MCP_TOOL_NAMES,
  MCP_TOOL_NAME_PATTERN,
  MCP_TOOLS,
  mcpToolNameSchema,
  resolveMcpTool,
  type McpToolName,
  type McpToolDescriptor,
  type McpToolResolution,
} from "./mcp/tools";
export {
  mcpIdSchema,
  mcpTimestampSchema,
  mcpSetAsideBasisSchema,
  mcpCountBasisSchema,
  mcpMeasuredCountSchema,
  LIST_OPEN_FIXES_MAX_ITEMS,
  LIST_OPEN_FIXES_DEFAULT_ITEMS,
  FINDING_EVIDENCE_MAX_ITEMS,
  FIX_ATTEMPT_CEILING,
  fixStatusSchema,
  findingEvidenceKindSchema,
  listOpenFixesInputSchema,
  getFixInputSchema,
  getFindingInputSchema,
  listWindowSchema,
  openFixSummarySchema,
  listOpenFixesOutputSchema,
  fixSpecEnvelopeSchema,
  findingEvidenceSchema,
  getFindingOutputSchema,
  type McpSetAsideBasis,
  type McpCountBasis,
  type McpMeasuredCount,
  type FixStatus,
  type FindingEvidenceKind,
  type ListOpenFixesInput,
  type GetFixInput,
  type GetFindingInput,
  type ListWindow,
  type OpenFixSummary,
  type ListOpenFixesOutput,
  type FixSpecEnvelope,
  type FindingEvidence,
  type GetFindingOutput,
} from "./mcp/types";

export { apiKeyMetadataSchema, type ApiKeyMetadata } from "./api-keys/types";
export {
  API_KEY_PREFIX,
  API_KEY_DISPLAY_PREFIX_LENGTH,
  isApiKeyFormat,
  hashApiKeyMaterial,
} from "./api-keys/material";

export {
  onboardingCountSchema,
  onboardingFindingSchema,
  endedReasonSchema,
  type OnboardingCount,
  type OnboardingFinding,
  type EndedReason,
  type CounterRow,
  type OnboardingCounterView,
  type FirstRunStatus,
} from "./onboarding/types";
export {
  ONBOARDING_PROPER_NOUNS,
  SET_UP_CTA_LABEL,
  LANDING_SETTLED_LINE,
  FIRST_RUN_TITLE,
  STEP_REPO_TITLE,
  STEP_REPO_WHAT_IT_WILL_DO,
  STEP_REPO_FILLER,
  STEP_ANALYTICS_TITLE,
  STEP_ANALYTICS_HELPER,
  FIELD_PROJECT_NUMBER_LABEL,
  FIELD_PROJECT_NUMBER_PLACEHOLDER,
  FIELD_PERSONAL_KEY_LABEL,
  FIELD_PERSONAL_KEY_HELPER,
  FIELD_REGION_DISCLOSURE,
  FIELD_REGION_LABEL,
  FIELD_REGION_PREFILL,
  CONNECT_ACTION_LABEL,
  CONNECT_PENDING_LABEL,
  DISCONNECT_ACTION_LABEL,
  DISCONNECT_CONFIRMATION,
  COUNTER_AS_OF_TEMPLATE,
  COUNTER_AS_OF_NEVER,
  RECEIPT_PATHS_LINE,
  RECEIPT_INTERNAL_DOMAIN_TEMPLATE,
  RECEIPT_INTERNAL_DOMAIN_UNKNOWN,
  RECEIPT_AUTOMATION_LINE,
  RECEIPT_FAIL_DIRECTION_LINE,
  RECEIPT_IDENTITY_LINE,
  RECEIPT_PROPERTIES_LINE,
  RECEIPT_OUTBOUND_LINE,
  RECEIPT_TITLE,
  RECEIPT_CLOSING_LINE,
  STEP_SLACK_TITLE,
  STEP_SLACK_HELPER,
  FIELD_BOT_TOKEN_LABEL,
  FIELD_BOT_TOKEN_PLACEHOLDER,
  FIELD_CHANNEL_ID_LABEL,
  FIELD_CHANNEL_ID_PLACEHOLDER,
  FIELD_CHANNEL_ID_HELPER,
  SEND_TEST_MESSAGE_LABEL,
  SEND_TEST_MESSAGE_PENDING,
  SKIP_FOR_NOW_LABEL,
  TRY_AGAIN_LABEL,
  SLACK_TEST_SUCCESS_TEMPLATE,
  SLACK_MUST_RECONNECT,
  SLACK_MUST_PICK_ANOTHER_CHANNEL,
  SLACK_SKIPPED_NOTICE,
  STEP_AGENT_TITLE,
  STEP_AGENT_WHAT_IT_WILL_DO,
  STEP_AGENT_FILLER,
  ROADMAP_LEAD,
  SETUP_SEEING_HEADING,
  SETUP_NEXT_ANALYTICS,
  SETUP_NEXT_DELIVERY,
  SETUP_NEXT_CHANNEL,
  STEP_MOMENT_TITLE,
  START_WATCHING_LABEL,
  WATCH_AGAIN_LABEL,
  DONE_LABEL,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
  STAGE_WATCHING_HEADING,
  STAGE_READING_HEADING,
  STAGE_WATCHING_HINT,
  STAGE_READING_HINT,
  STAGE_FOUND_HEADING,
  STAGE_FOUND_HINT,
  STAGE_ENDED_HINT,
  STAGE_FINDING_UNAVAILABLE,
  STAGE_LOG_ARMED,
  STAGE_LOG_RETRIEVED,
  STAGE_LOG_READING,
  STAGE_OFFLINE_NOTICE,
  STAGE_RETIRE_TEMPLATE,
  STRIP_LEAD,
  STRIP_SEEN_TEMPLATE,
  STRIP_COUNTED_TEMPLATE,
  STRIP_POSTING_TO_TEMPLATE,
  STRIP_REOPEN_LABEL,
  FINDING_CLASS_UNKNOWN_TEMPLATE,
  FINDING_CONFIDENCE_UNKNOWN,
  NETWORK_FAILURE_NOTICE,
  ONBOARDING_MESSAGES,
  ALL_ONBOARDING_MESSAGES,
} from "./onboarding/messages";
export {
  isAnalyticsAttached,
  LIVE_STEP_DESCRIPTORS,
  COMING_NEXT_DESCRIPTORS,
  displayOrdinal,
  stepStateSchema,
  stepIdSchema,
  confirmationIdSchema,
  STEP_DESCRIPTORS,
  deriveStepStates,
  type StepState,
  type StepId,
  type ConfirmationId,
  type FieldDescriptor,
  type ActionDescriptor,
  type StepDescriptor,
  type ComingNextStep,
  type WorkStep,
  type StageStep,
  type StepSequenceFacts,
  type StepView,
} from "./onboarding/steps";
export {
  nextBlocker,
  canArm,
  SETUP_BLOCKERS,
  type SetupBlocker,
  type SetupBlockerId,
  type SetupFacts,
} from "./onboarding/blockers";
export { toOnboardingCounterView } from "./onboarding/counter-view";
export {
  buildPrivacyReceipt,
  type ReceiptLine,
  type PrivacyReceiptInput,
} from "./onboarding/privacy-receipt";
export { reduceStage, type StagePersistedFacts, type RenderedStageState } from "./onboarding/stage";
export { renderStageView, type StageLogLine, type StageView } from "./onboarding/stage-view";
export { toFindingView, type FindingCountLine, type FindingView } from "./onboarding/finding-view";
export {
  describeTestPostOutcome,
  type TestPostInput,
  type TestPostOutcome,
} from "./onboarding/slack-test";

export {
  firstRunAnalyticsConnectInputSchema,
  firstRunAnalyticsDisconnectInputSchema,
  firstRunArmInputSchema,
  firstRunDismissInputSchema,
  firstRunSlackConnectInputSchema,
  firstRunSlackSkipInputSchema,
  firstRunSlackTestInputSchema,
  firstRunStatusInputSchema,
  type FirstRunAnalyticsConnectInput,
  type FirstRunSlackConnectInput,
} from "./onboarding/route-schemas";
