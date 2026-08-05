export { createDb, ping, type Db } from "./client";
export {
  getSchemaStatus,
  compareMigrationCounts,
  describeSchemaStatus,
  type SchemaStatus,
} from "./schema-status";
export * as schema from "./schema";

export type { ScopedDb } from "./repositories/types";

export {
  createProjectsRepo,
  type ProjectsRepo,
  type ProjectRecord,
} from "./repositories/projects.repo";
export {
  createWriteKeysRepo,
  resolveWriteKeyForIngest,
  type WriteKeysRepo,
  type MintedWriteKey,
  type WriteKeyRow,
} from "./repositories/write-keys.repo";
export {
  createOrganizationsRepo,
  type OrganizationsRepo,
  type OrganizationRecord,
} from "./repositories/organizations.repo";

export {
  findMembershipsByUserId,
  findNewestAccountProviderId,
  findUserNameById,
} from "./tenancy/queries";
export { ensureOrganization } from "./tenancy/ensure-organization";

export {
  createProjectConnectionsRepo,
  toConnectionSummary,
  type ProjectConnectionsRepo,
  type ProjectConnectionRow,
  type InsertActiveConnectionInput,
  type RecordHealthInput,
  type AdvanceWatermarkInput,
  type SetInferredInternalDomainInput,
} from "./repositories/project-connections.repo";
export {
  createSessionsRepo,
  type SessionsRepo,
  type SessionRecord,
  type SessionUpsertRow,
} from "./repositories/sessions.repo";
export {
  createEventsRepo,
  type EventsRepo,
  type EventRecord,
  type EventInsertRow,
} from "./repositories/events.repo";
export {
  createPollRunsRepo,
  type PollRunsRepo,
  type PollRunRecord,
  type StartPollRunInput,
  type PollRunCounts,
  type PollRunTerminal,
  type PollRunAggregate,
} from "./repositories/poll-runs.repo";

export {
  createConnectionsService,
  connectInputSchema,
  type ConnectionsService,
  type ConnectionsServiceDeps,
  type ConnectInput,
  type AttachableSource,
  type CreateSourceFn,
  type SourceConnectionConfig,
} from "./services/connections.service";
export {
  persistPullResult,
  type IntakeConnection,
  type IntakeCounts,
} from "./services/intake.service";
export {
  createEventsCounterService,
  type EventsCounterService,
} from "./services/events-counter.service";

export {
  createDetectorCorpusService,
  type DetectorCorpusService,
} from "./services/detector-corpus.service";

export {
  SIGNATURE_HEX_LENGTH,
  SIGNATURE_HEX_FORMAT,
  SIGNATURE_DISPLAY_PREFIX_LENGTH,
  isSignatureHex,
  signatureHex,
  sha256Hex,
  signatureDisplayPrefix,
  type SignatureHex,
} from "./signatures/hex";
export {
  createFindingSignaturesRepo,
  type FindingSignaturesRepo,
  type FindingSignatureRecord,
  type UpsertSeenInput,
  type CarryForwardInput,
} from "./repositories/finding-signatures.repo";
export {
  createDismissalsRepo,
  type DismissalsRepo,
  type DismissalRecord,
} from "./repositories/dismissals.repo";
export {
  createSignatureAncestryRepo,
  type SignatureAncestryRepo,
  type AncestryRecord,
  type AncestryResolution,
} from "./repositories/signature-ancestry.repo";
export {
  createSignatureLedgerService,
  computeFindingSignature,
  type SignatureLedgerService,
  type ComputeFindingSignatureInput,
  type RecordSignatureResult,
  type RecordDismissalInput,
  type RecordAncestryInput,
} from "./services/signature-ledger.service";
export {
  createDeliveriesRepo,
  resolveDeliveryForInteraction,
  DELIVERY_CONFLICT_TARGET,
  type DeliveriesRepo,
  type DeliveryRecord,
  type ClaimDeliveryInput,
  type ClaimDeliveryResult,
  type MarkPostedInput,
  type MarkFailedInput,
  type InteractionPrincipal,
} from "./repositories/deliveries.repo";

export {
  createApiKeysRepo,
  resolveApiKeyPrincipal,
  apiKeyIdOf,
  stampApiKeyUse,
  API_KEY_ACTOR_PREFIX,
  API_KEY_ACTOR_ROLE,
  API_KEY_USE_STAMP_INTERVAL_SECONDS,
  type ApiKeysRepo,
  type MintedApiKey,
  type ApiKeyRow,
} from "./repositories/api-keys.repo";

export {
  createFixesRepo,
  FIX_CONFLICT_COLUMNS,
  OPEN_FIX_STATUS,
  type FixesRepo,
  type FixRow,
  type ClaimFixInput,
  type CountOpenFixesOptions,
} from "./repositories/fixes.repo";

export {
  createFindingPayloadsRepo,
  FINDING_PAYLOAD_CONFLICT_TARGET,
  type FindingPayloadsRepo,
  type FindingPayloadRow,
  type UpsertFindingPayloadInput,
} from "./repositories/finding-payloads.repo";

export {
  createFixesService,
  type FixesService,
  type OpenFixResult,
  type OpenFixReadModel,
  type FixReadModel,
  type FindingReadModel,
  type ListOpenFixesInput,
  type ListOpenFixesPage,
} from "./services/fixes.service";

export {
  describeHold,
  findingContextSchema,
  joinScanned,
  readFindingText,
  trimScanned,
  type FindingText,
  type FindingTextRow,
  type HeldFindingText,
  type HoldDescription,
  type ScannedText,
} from "./repositories/finding-text";

export {
  createFindingsRepo,
  measuredCountRowSchema,
  FINDING_CONFLICT_TARGET,
  type FindingsRepo,
  type FindingRecord,
  type PersistFindingInput,
  type ListFindingsOptions,
  type MeasuredCountRow,
} from "./repositories/findings.repo";

export {
  createRecordingSummariesRepo,
  RECORDING_SUMMARY_CONFLICT_TARGET,
  type RecordingSummariesRepo,
  type RecordingSummaryRecord,
  type PersistRecordingSummaryInput,
  type SessionRecordingCitation,
  type StoredTranscript,
  type StoredTranscriptAction,
} from "./repositories/recording-summaries.repo";

export type { TranscriptPullStop } from "./schema/recording-summaries";

export {
  createAnalysisRunsRepo,
  ANALYSIS_RUN_LEASE_MS,
  type AnalysisRunsRepo,
  type AnalysisRunRecord,
  type OpenRunInput,
  type OpenRunResult,
  type CloseRunInput,
  type ClaimModelCallInput,
  type ClaimModelCallResult,
} from "./repositories/analysis-runs.repo";

export {
  createSlackConnectionsRepo,
  toSlackConnectionSummary,
  SlackConnectionWriteError,
  type SlackConnectionsRepo,
  type SlackConnectionRow,
  type SlackConnectionSummary,
  type InsertActiveSlackConnectionInput,
} from "./repositories/slack-connections.repo";

// AD-4's guard, exported from this barrel rather than "./system" because both the worker's
// lane source and the web app's test-post route consult it, and "./system" is unreachable
// from `apps/`.
export {
  isDeliveryTarget,
  type ChannelBearingConnection,
  type DeliveryTarget,
} from "./services/delivery-channel-guard";

// The one safe way to put a failed query in a log: every caller outside this package
// reaches the driver through here, so nothing else has to know what the message holds.
export { describeDriverError } from "./repositories/driver-error";

export { publishLive } from "./live/publish";
export {
  subscribeLive,
  nextBackoffMs,
  LIVE_RECONNECT_MIN_MS,
  LIVE_RECONNECT_MAX_MS,
  type LiveSubscription,
  type LiveSubscribeDeps,
} from "./live/subscribe";

export { slackCredentialAad } from "./schema/slack-connections";
export {
  createFirstRunRepo,
  type FirstRunRepo,
  type FirstRunState,
} from "./repositories/first-run.repo";
export {
  createProviderInterestRepo,
  type ProviderInterestRepo,
  type ProviderInterestNote,
} from "./repositories/provider-interest.repo";
export {
  createFirstRunStatusService,
  type FirstRunStatusFacts,
  type FirstRunStatusService,
} from "./services/first-run-status.service";
export { ensureProject, findFirstProjectForOrg } from "./tenancy/ensure-project";

export { and, eq, sql } from "drizzle-orm";
export {
  createGrowthContextRepo,
  type GrowthContextRepo,
  type GrowthContextRow,
  type GrowthContextSnapshot,
  type StatePageRoleInput,
  type BusinessResearchRow,
  type StateFactInput,
  type StateFactOutcome,
  type SaveGrowthContextInput,
} from "./repositories/growth-context.repo";
export {
  createGrowthContextService,
  GROWTH_CONTEXT_ITEM_LIMIT,
  type GrowthContextService,
  type GrowthContextReadModel,
  type ReadGrowthContextInput,
  type RoledSurfaceNote,
  type KnownProblemRow,
  type DeclinedIdeaRow,
} from "./services/growth-context.service";
export {
  createSurfaceObservationsService,
  OBSERVED_SURFACE_LIMIT,
  type SurfaceObservationsService,
  type ObserveSurfacesInput,
} from "./services/surface-observations.service";
export { enqueueJob } from "./jobs/enqueue";
