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

// Tenancy bootstrap — the reads that resolve a request's identity BEFORE any
// organization scope exists, plus the org auto-creation they trigger.
// Deliberately unscoped (no `TenantContext` parameter); see the header of
// ./tenancy/queries.ts for the invariants that keeps safe.
// `findOrganizationBySlug` is deliberately absent: it is the one tenancy query
// keyed on something other than the caller's own user id, so it stays internal
// to ./tenancy, where its only consumer lives.
export { findMembershipsByUserId, findUserNameById } from "./tenancy/queries";
export { ensureOrganization } from "./tenancy/ensure-organization";

// --- O-003 -----------------------------------------------------------------
// NOTE: src/system/* is deliberately absent from this barrel. It is reachable
// only through the "./system" subpath, and a committed test asserts that none
// of its three functions is exported here.
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
