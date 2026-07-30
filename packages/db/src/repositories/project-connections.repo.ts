// Repository for the `project_connections` table. D-B: the factory takes a
// `TenantContext` at construction — the only way to name an organization —
// and no method below accepts an organization id as a parameter. Every read
// filters on `ctx.organizationId`; every mutation is keyed on
// `(ctx.organizationId, id)` with `.returning()`, so a foreign-org id affects
// zero rows and returns `null` rather than silently succeeding.
//
// NO METHOD RETURNS CREDENTIAL MATERIAL. Every method returns
// `ConnectionSummary`, built field-by-field by `toSummary` below — never a
// spread of the row — so `credential_ciphertext` cannot leak through by
// accident. The worker reads the ciphertext through one named, org-keyed
// function in src/system/, which is greppable by design.
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw. A later wave fills in the Drizzle queries against these exact
// signatures.
import type {
  ConnectionHealth,
  ConnectionSummary,
  InternalDomainProvenance,
  SessionSourceKind,
  SourceFailureCode,
  TenantContext,
} from "@growthmind/shared";

import type { projectConnections } from "../schema/project-connections";
import type { ScopedDb } from "./types";

/** The raw persisted row — INCLUDES the ciphertext, unlike
 * `ConnectionSummary`. Never return this type from a repository method. */
export type ProjectConnectionRow = typeof projectConnections.$inferSelect;

export interface InsertActiveConnectionInput {
  projectId: string;
  sourceKind: SessionSourceKind;
  host: string;
  sourceProjectId: string;
  credentialCiphertext: string;
  credentialKeyId: string;
  health: ConnectionHealth;
  connectedAt: Date;
  nextPollAt: Date;
}

export interface RecordHealthInput {
  health: ConnectionHealth;
  reasonCode: SourceFailureCode | null;
  reasonMessage: string | null;
  checkedAt: Date;
}

export interface AdvanceWatermarkInput {
  /** The newest CONTIGUOUSLY covered event time. */
  watermarkAt: Date;
  /** The resume cursor for an unfinished backward walk, or `null` when the
   * walk was contiguous. */
  backfillBefore: string | null;
}

export interface SetInferredInternalDomainInput {
  domain: string | null;
  provenance: InternalDomainProvenance | null;
}

export interface ProjectConnectionsRepo {
  /** The one ACTIVE attachment for `projectId`, or `null`. Org-filtered, so
   * a foreign org's project id yields `null` rather than data. */
  getActiveForProject(projectId: string): Promise<ConnectionSummary | null>;
  /**
   * Inserts an active attachment. Relies on the partial unique index
   * `(project_id) WHERE is_active` to refuse a second source — NO
   * read-then-write, so two concurrent attach attempts cannot both win (D6).
   * The caller maps the constraint violation to a `second_source` refusal.
   */
  insertActive(input: InsertActiveConnectionInput): Promise<ConnectionSummary>;
  /** Re-keys an existing attachment. `null` for a foreign org's id. */
  updateCredential(
    id: string,
    input: { credentialCiphertext: string; credentialKeyId: string },
  ): Promise<ConnectionSummary | null>;
  /** Clears `is_active` and sets health `disconnected`. The row and every
   * session and event it produced are kept. */
  deactivate(id: string): Promise<ConnectionSummary | null>;
  recordHealth(id: string, input: RecordHealthInput): Promise<ConnectionSummary | null>;
  /**
   * MONOTONIC: a value at or before the stored watermark leaves it untouched,
   * so a late or out-of-order run cannot drag the cursor backwards and
   * re-open a window we have already covered (D6).
   */
  advanceWatermark(id: string, input: AdvanceWatermarkInput): Promise<ConnectionSummary | null>;
  setInferredInternalDomain(
    id: string,
    input: SetInferredInternalDomainInput,
  ): Promise<ConnectionSummary | null>;
}

/**
 * Maps a persisted row to the DTO boundary as an explicit field-by-field
 * pick, never a spread or a cast, so `credentialCiphertext` (and any future
 * sensitive column) cannot leak through by accident.
 */
export function toConnectionSummary(_row: ProjectConnectionRow): ConnectionSummary {
  throw new Error("TYPED STUB (O-003 scaffold): toConnectionSummary");
}

export function createProjectConnectionsRepo(
  _db: ScopedDb,
  _ctx: TenantContext,
): ProjectConnectionsRepo {
  throw new Error("TYPED STUB (O-003 scaffold): createProjectConnectionsRepo");
}
