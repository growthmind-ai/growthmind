// The connection lifecycle: attach, read state, detach (O-003 D-1, D-7,
// FR-8/FR-9/FR-11).
//
// WHY THE SOURCE FACTORY IS INJECTED. packages/db must never depend on
// packages/adapters — that would invert the layering and drag a vendor
// implementation into the data layer. So the service takes a `CreateSourceFn`
// as a dependency, typed structurally against the shapes both packages
// already share via @growthmind/shared. `SessionSource` from
// packages/adapters satisfies `AttachableSource` structurally, with no import
// and no cast. The same injection is what makes every test here run against a
// fake source with no network at all (FR-2).
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw.
import type {
  ConnectResult,
  ConnectionState,
  CredentialKeyResolution,
  SessionSourceKind,
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  TenantContext,
} from "@growthmind/shared";

import type { ScopedDb } from "../repositories/types";

/**
 * The structural shape this service needs from a source. Deliberately narrower
 * than `SessionSource` — it does not name `kind` — so nothing here can branch
 * on a vendor name. The vendor name does not exist below the composition root.
 */
export interface AttachableSource {
  validate(): Promise<SessionSourceValidation>;
  pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult>;
}

export interface SourceConnectionConfig {
  host: string;
  sourceProjectId: string;
  /** Held only for the lifetime of the call. Never logged, never returned. */
  personalApiKey: string;
}

export type CreateSourceFn = (config: SourceConnectionConfig) => AttachableSource;

export interface ConnectionsServiceDeps {
  createSource: CreateSourceFn;
  /**
   * The resolved credential key, or the named refusal. A
   * `{ ok: false, reason: "insecure_default_key" }` here becomes a
   * `misconfigured` connect refusal whose message names the one step to fix
   * it — the D-1 gate the insecure-defaults bypass cannot open. Boot still
   * succeeds; storing a customer's secret does not.
   */
  credentialKey: CredentialKeyResolution;
  now: () => Date;
}

export interface ConnectInput {
  projectId: string;
  sourceKind: SessionSourceKind;
  host: string;
  sourceProjectId: string;
  personalApiKey: string;
}

export interface ConnectionsService {
  /**
   * The attach flow, in this order:
   *   1. Resolve the credential key; a refusal short-circuits to
   *      `misconfigured` with NO row written and NO request made.
   *   2. `validate()` through the INJECTED source factory. A failure records
   *      a terminal health state and never leaves an active row behind (D8) —
   *      wrong-credentials, wrong-project, and unreachable stay distinct.
   *   3. Encrypt the key under the `(organizationId, projectId)` additional
   *      authenticated data and insert. A second source is refused by the
   *      partial unique index, never by a prior read (D6), and the refusal
   *      names the existing attachment and the cutover path.
   *   4. Infer the internal domain from the org creator's email and record
   *      its provenance. No resolvable creator email ⇒ infer nothing (F-2).
   *   5. ONE bounded inline first pull, so the counter is non-zero the moment
   *      onboarding step 2 completes — this serves the glue moment better
   *      than any faster background tick would.
   */
  connect(input: ConnectInput): Promise<ConnectResult>;
  /**
   * The seven-state read O-008 renders. `not_connected` (no row at all),
   * `connected_never_polled` (null watermark), and
   * `connected_no_events_yet` (polled, found nothing) are three DIFFERENT
   * answers and are never collapsed into one.
   */
  getState(projectId: string): Promise<ConnectionState>;
  /**
   * Deactivates the project's attachment. Requires organization membership
   * only — matching the shipped member-vs-non-member floor. A role gate is a
   * named future decision, deliberately not designed in here, and the shape
   * above admits one without a redesign.
   *
   * Every session and event already collected is KEPT.
   */
  disconnect(projectId: string): Promise<ConnectionState>;
}

export function createConnectionsService(
  _db: ScopedDb,
  _ctx: TenantContext,
  _deps: ConnectionsServiceDeps,
): ConnectionsService {
  throw new Error("TYPED STUB (O-003 scaffold): createConnectionsService");
}
