// The "./system" subpath's entire surface: the read-only system reads, the
// scheduled-actor vocabulary, and nothing else (D-10; `listAnalysableProjects`
// added later under the same rules).
//
// Deliberately NOT re-exported from src/index.ts. The subpath boundary is
// what makes a violating import a single greppable line, and
// __tests__/system/reachability.test.ts turns that convention into a gate:
// no file under apps/ imports this module, the actor vocabulary is named only
// here, in worker/, and in tests, the main barrel exports none of these
// functions, and `PollableConnection` carries no credential-bearing field.
//
// `systemContextFor` is the sharpest thing behind this boundary: it mints a
// tenant context for an arbitrary organization with no user present. It is
// exported here because the worker's three scheduled tasks genuinely need it,
// and nowhere else for the same reason.
export {
  claimDuePollableConnections,
  readConnectionCredential,
  type PollableConnection,
} from "./pollable-connections";
export { listAnalysableProjects, type AnalysableProject } from "./analysable-projects";
export { systemTenantContextFor } from "./system-context";
export {
  SYSTEM_ACTOR,
  SYSTEM_ACTOR_ROLE,
  systemContextFor,
  type SystemActor,
  type SystemScopeSource,
} from "./system-actor";
