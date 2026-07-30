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
