export { createDb, ping, type Db } from "./client";
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

// Tenancy bootstrap, the reads that resolve a request's identity before any
// organization scope exists, plus the org auto-creation they trigger. Deliberately
// unscoped (no `TenantContext` parameter); see the header of./tenancy/queries.ts for
// the invariants that keeps safe. `findOrganizationBySlug` is deliberately absent: it
// is the one tenancy query keyed on something other than the caller's own user id, so
// it stays internal to./tenancy, where its only consumer lives.
export { findMembershipsByUserId, findUserNameById } from "./tenancy/queries";
export { ensureOrganization } from "./tenancy/ensure-organization";

// -- NOTE: src/system/* is deliberately absent from this barrel. It is reachable only
// through the "./system" subpath, and a committed test asserts that none of its three
// functions is exported here.
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

// --
export {
  createDetectorCorpusService,
  type DetectorCorpusService,
} from "./services/detector-corpus.service";

// --
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
  DELIVERY_CONFLICT_TARGET,
  type DeliveriesRepo,
  type DeliveryRecord,
  type ClaimDeliveryInput,
  type ClaimDeliveryResult,
  type MarkPostedInput,
  type MarkFailedInput,
} from "./repositories/deliveries.repo";

// -- The read credential store. `resolveApiKeyForRead` sits beside the factory exactly
// as `resolveWriteKeyForIngest` does: it takes no tenant context, because the presented
// material IS the tenant proof.
//
// NOTE: src/admin/* is deliberately absent from this barrel, the same way src/system/*
// is. It is reachable only through the "./admin" subpath, and a committed test asserts
// nothing here re-exports it.
export {
  createApiKeysRepo,
  resolveApiKeyForRead,
  type ApiKeysRepo,
  type MintedApiKey,
  type ApiKeyRow,
  type ResolvedApiKey,
} from "./repositories/api-keys.repo";

// -- The analysis lane's two repositories. NOTE: `findings` has NO consumer this
// sprint. The `delivery-tick` lane-source wire is deliberately cut and lands with the
// first sprint that needs findings flowing to delivery. The full statement lives in
// `./repositories/findings.repo.ts`'s header.
export {
  createFindingsRepo,
  findingContextSchema,
  measuredCountRowSchema,
  FINDING_CONFLICT_TARGET,
  type FindingsRepo,
  type FindingRecord,
  type PersistFindingInput,
  type ListFindingsOptions,
  type MeasuredCountRow,
} from "./repositories/findings.repo";
// `ANALYSIS_RUN_LEASE_MS` is re-exported deliberately. The worker's own comments reason
// about it in prose (`worker/src/tasks/ analysis-tick.ts`), so a constant the worker
// argues from must be reachable from the barrel the worker imports, not only through a
// deep path into `./repositories/analysis-runs.repo`, which until now was how the
// single consumer (that repository's own suite) got at it.
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

// --- O-008: the first-run surface --------------------------------------------
// NOTE: `existsAnyActiveSlackConnection` and its two siblings are deliberately
// absent from this barrel, exactly as the other system reads are. They live
// behind the "./system" subpath and nothing here re-exports them.
//
// `openCredentialForOrg` IS reachable from here, on the repository this barrel
// exports, and that is a deliberate difference from the PostHog credential —
// AD-20 puts the Slack door on the repository so the delivery composition root
// can build it per lane from the lane's own context. It is COMPOSITION-ROOT
// ONLY, stated on the method itself, and its name is the grep.
export {
  createSlackConnectionsRepo,
  toSlackConnectionSummary,
  SlackConnectionWriteError,
  type SlackConnectionsRepo,
  type SlackConnectionRow,
  type SlackConnectionSummary,
  type InsertActiveSlackConnectionInput,
} from "./repositories/slack-connections.repo";
// The AAD this table's credential is sealed under has EXACTLY ONE PRODUCER, and
// it is re-exported here so every consumer reaches it through the barrel rather
// than deep-importing the schema module. It takes a `TenantContext` and no
// project id, deliberately: an envelope sealed with `credentialAad(orgId,
// projectId)` writes fine and fails at delivery time, per customer, silently.
export { slackCredentialAad } from "./schema/slack-connections";
export {
  createFirstRunRepo,
  type FirstRunRepo,
  type FirstRunState,
} from "./repositories/first-run.repo";
export {
  createFirstRunStatusService,
  type FirstRunStatusService,
} from "./services/first-run-status.service";
export { ensureProject } from "./tenancy/ensure-project";
