export { serverEnvSchema, parseServerEnv, DEV_ENCRYPTION_KEY, type ServerEnv } from "./env";

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
  type SignUpInput,
  type SignInInput,
  type WorkspaceName,
} from "./forms";

// --- O-003: credential encryption at rest -----------------------------------
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

// --- O-003: the SessionSource port's shapes ---------------------------------
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

// --- O-004: the evidence gate's plain-English reasons (D-19) ----------------
// Defined here so `ALL_CUSTOMER_FACING_MESSAGES` (and the plain-English audit
// that scans it) covers them; `packages/core` imports them back for the trace.
export { GATE_REASON_MESSAGES, type GateReasonKey } from "./gate/messages";

// --- O-003: exclusions ------------------------------------------------------
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

// --- O-003: session assembly ------------------------------------------------
export {
  deriveSessionKey,
  SESSION_GROUPING_VERSION,
  SESSION_BUCKET_MS,
  type SessionKeyInput,
} from "./sessions/grouping";
export { normaliseUrlPath, URL_PATH_NORMALISATION_VERSION } from "./sessions/url-path";
export {
  hashIdentityKey,
  deriveIdentityHmacKey,
  type IdentityHmacKey,
} from "./sessions/identity-key";

// --- O-003: the onboarding counter ------------------------------------------
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

// --- O-005: the cold-start lane's shapes ------------------------------------
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
  ALL_CUSTOMER_FACING_MESSAGES as SUMMARY_ALL_CUSTOMER_FACING_MESSAGES,
} from "./summary/messages";

// --- O-006: the signature ledger's shapes -----------------------------------
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
