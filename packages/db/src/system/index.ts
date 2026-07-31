// The "./system" subpath's entire surface: four read-only exports and their
// types, and nothing else (O-003 D-10; `listAnalysableProjects` added by
// O-012 under the same rules).
//
// Deliberately NOT re-exported from src/index.ts. The subpath boundary is
// what makes a violating import a single greppable line, and
// __tests__/system/reachability.test.ts turns that convention into a gate:
// no file under apps/ imports this module, SYSTEM_ACTOR_ID appears only here,
// in worker/, and in tests, the main barrel exports none of these three
// functions, and `PollableConnection` carries no credential-bearing field.
export {
  claimDuePollableConnections,
  readConnectionCredential,
  type PollableConnection,
} from "./pollable-connections";
export { listAnalysableProjects, type AnalysableProject } from "./analysable-projects";
export { systemTenantContextFor, SYSTEM_ACTOR_ID, SYSTEM_ACTOR_ROLE } from "./system-context";
