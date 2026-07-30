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
