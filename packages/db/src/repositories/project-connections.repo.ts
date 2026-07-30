// Repository for the `project_connections` table. D-B: the factory takes a
// `TenantContext` at construction — the only way to name an organization —
// and no method below accepts an organization id as a parameter. Every read
// filters on `ctx.organizationId`; every mutation is keyed on
// `(ctx.organizationId, id)` with `.returning()`, so a foreign-org id affects
// zero rows and returns `null` rather than silently succeeding.
//
// NO METHOD RETURNS CREDENTIAL MATERIAL. Every method returns
// `ConnectionSummary`, built field-by-field by `toConnectionSummary` below —
// never a spread of the row — so `credential_ciphertext` cannot leak through by
// accident. The worker reads the ciphertext through one named, org-keyed
// function in src/system/, which is greppable by design.
import type {
  ConnectionHealth,
  ConnectionSummary,
  InternalDomainProvenance,
  SessionSourceKind,
  SourceFailureCode,
  TenantContext,
} from "@growthmind/shared";
import { and, eq, sql } from "drizzle-orm";

import { projectConnections } from "../schema/project-connections";
import { projects } from "../schema/projects";
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
 * A write refused by the database, re-thrown WITHOUT the driver's parameter
 * echo. See `rethrowWithoutParameters` — this exists because drizzle's own
 * error message inlines every bound parameter, ciphertext included.
 *
 * `constraint` is what the connections service branches on to produce the
 * `second_source` refusal: the index name, never a parsed message.
 */
export class ConnectionWriteError extends Error {
  readonly code: string | null;
  readonly constraint: string | null;

  constructor(message: string, code: string | null, constraint: string | null) {
    super(message);
    this.name = "ConnectionWriteError";
    this.code = code;
    this.constraint = constraint;
  }
}

interface DriverErrorFields {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
}

function readDriverFields(error: unknown): DriverErrorFields {
  // drizzle wraps the driver error as `cause` and puts the SQL + BOUND
  // PARAMETERS in its own `message`. The driver error underneath carries the
  // constraint name and no parameter values, so that is the one we surface.
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  const candidate = (cause ?? error) as DriverErrorFields | null | undefined;
  return candidate ?? {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * FR-7. A constraint violation is an error string a customer, a log line, or a
 * Sentry breadcrumb can see, and drizzle's `DrizzleQueryError.message` is
 * literally `Failed query: … params: <every bound value>` — which for this
 * table means the AES envelope. Re-throwing the raw error would put a
 * customer's encrypted PostHog key into every log that catches it.
 *
 * So: surface the DRIVER's own message (constraint names, never parameter
 * values), scrub the values we know we just wrote as a belt-and-braces second
 * pass, and deliberately attach NO `cause` — a cause chain would print the
 * parameter echo again the moment anyone logs the error object.
 */
function rethrowWithoutParameters(error: unknown, secrets: readonly string[]): never {
  const fields = readDriverFields(error);
  const driverMessage =
    asStringOrNull(fields.message) ??
    (error instanceof Error ? error.message : String(error)) ??
    "database write refused";

  let scrubbed = driverMessage;
  for (const secret of secrets) {
    if (secret.length > 0) {
      scrubbed = scrubbed.split(secret).join("[redacted]");
    }
  }

  throw new ConnectionWriteError(
    scrubbed,
    asStringOrNull(fields.code),
    asStringOrNull(fields.constraint),
  );
}

/**
 * Maps a persisted row to the DTO boundary as an explicit field-by-field
 * pick, never a spread or a cast, so `credentialCiphertext` (and any future
 * sensitive column) cannot leak through by accident.
 */
export function toConnectionSummary(row: ProjectConnectionRow): ConnectionSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    sourceKind: row.sourceKind,
    host: row.host,
    sourceProjectId: row.sourceProjectId,
    isActive: row.isActive,
    health: row.health,
    healthReasonCode: row.healthReasonCode,
    healthReasonMessage: row.healthReasonMessage,
    healthCheckedAt: row.healthCheckedAt,
    watermarkAt: row.watermarkAt,
    backfillBefore: row.backfillBefore,
    pollIntervalSeconds: row.pollIntervalSeconds,
    connectedAt: row.connectedAt,
    inferredInternalDomain: row.inferredInternalDomain,
    internalDomainProvenance: row.internalDomainProvenance,
  };
}

export function createProjectConnectionsRepo(
  db: ScopedDb,
  ctx: TenantContext,
): ProjectConnectionsRepo {
  /**
   * D7. The partial unique index is on `(project_id) WHERE is_active` and
   * carries NO organization id, so it cannot enforce tenancy on its own: a
   * foreign org naming another org's project id would consume that project's
   * one active slot and permanently block its real owner from connecting —
   * a suppression attack, not a leak, and therefore silent. Verifying
   * ownership first closes it. This is a lookup on an immutable relationship
   * (a project never changes organization), so it is not the read-then-write
   * race D6 forbids.
   */
  async function assertProjectIsOurs(projectId: string): Promise<void> {
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.id, projectId)))
      .limit(1);

    if (!owned) {
      throw new ConnectionWriteError("project not found in this organization", null, null);
    }
  }

  return {
    async getActiveForProject(projectId: string): Promise<ConnectionSummary | null> {
      const [row] = await db
        .select()
        .from(projectConnections)
        .where(
          and(
            eq(projectConnections.organizationId, ctx.organizationId),
            eq(projectConnections.projectId, projectId),
            eq(projectConnections.isActive, true),
          ),
        )
        .limit(1);

      return row ? toConnectionSummary(row) : null;
    },

    async insertActive(input: InsertActiveConnectionInput): Promise<ConnectionSummary> {
      await assertProjectIsOurs(input.projectId);

      try {
        const [row] = await db
          .insert(projectConnections)
          .values({
            organizationId: ctx.organizationId,
            projectId: input.projectId,
            sourceKind: input.sourceKind,
            host: input.host,
            sourceProjectId: input.sourceProjectId,
            credentialCiphertext: input.credentialCiphertext,
            credentialKeyId: input.credentialKeyId,
            isActive: true,
            health: input.health,
            connectedAt: input.connectedAt,
            nextPollAt: input.nextPollAt,
          })
          .returning();

        if (!row) {
          throw new ConnectionWriteError("insertActive: insert returned no row", null, null);
        }

        return toConnectionSummary(row);
      } catch (error) {
        if (error instanceof ConnectionWriteError) {
          throw error;
        }
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async updateCredential(
      id: string,
      input: { credentialCiphertext: string; credentialKeyId: string },
    ): Promise<ConnectionSummary | null> {
      try {
        const [row] = await db
          .update(projectConnections)
          .set({
            credentialCiphertext: input.credentialCiphertext,
            credentialKeyId: input.credentialKeyId,
          })
          .where(
            and(
              eq(projectConnections.organizationId, ctx.organizationId),
              eq(projectConnections.id, id),
            ),
          )
          .returning();

        return row ? toConnectionSummary(row) : null;
      } catch (error) {
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async deactivate(id: string): Promise<ConnectionSummary | null> {
      const [row] = await db
        .update(projectConnections)
        .set({ isActive: false, health: "disconnected" })
        .where(
          and(
            eq(projectConnections.organizationId, ctx.organizationId),
            eq(projectConnections.id, id),
          ),
        )
        .returning();

      return row ? toConnectionSummary(row) : null;
    },

    async recordHealth(id: string, input: RecordHealthInput): Promise<ConnectionSummary | null> {
      const [row] = await db
        .update(projectConnections)
        .set({
          health: input.health,
          healthReasonCode: input.reasonCode,
          healthReasonMessage: input.reasonMessage,
          healthCheckedAt: input.checkedAt,
        })
        .where(
          and(
            eq(projectConnections.organizationId, ctx.organizationId),
            eq(projectConnections.id, id),
          ),
        )
        .returning();

      return row ? toConnectionSummary(row) : null;
    },

    async advanceWatermark(
      id: string,
      input: AdvanceWatermarkInput,
    ): Promise<ConnectionSummary | null> {
      // ATOMIC AND MONOTONIC IN ONE STATEMENT (D6). `greatest` is evaluated by
      // Postgres against the row's CURRENT value under the update's own row
      // lock, so two runs landing in either order both end at the furthest
      // watermark — neither can lose the other's progress, and a stale value
      // is a no-op rather than a rewind. A read-then-write would need the
      // comparison in JS, which is exactly the lost update this replaces.
      //
      // `greatest` ignores NULLs in Postgres, so a never-polled connection
      // (`watermark_at IS NULL`) advances to the incoming value rather than
      // collapsing to NULL.
      const [row] = await db
        .update(projectConnections)
        .set({
          watermarkAt: sql`greatest(${projectConnections.watermarkAt}, ${input.watermarkAt}::timestamptz)`,
          backfillBefore: input.backfillBefore,
        })
        .where(
          and(
            eq(projectConnections.organizationId, ctx.organizationId),
            eq(projectConnections.id, id),
          ),
        )
        .returning();

      return row ? toConnectionSummary(row) : null;
    },

    async setInferredInternalDomain(
      id: string,
      input: SetInferredInternalDomainInput,
    ): Promise<ConnectionSummary | null> {
      const [row] = await db
        .update(projectConnections)
        .set({
          inferredInternalDomain: input.domain,
          internalDomainProvenance: input.provenance,
        })
        .where(
          and(
            eq(projectConnections.organizationId, ctx.organizationId),
            eq(projectConnections.id, id),
          ),
        )
        .returning();

      return row ? toConnectionSummary(row) : null;
    },
  };
}
