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
  watermarkAt: Date;

  backfillBefore: string | null;
}

export interface SetInferredInternalDomainInput {
  domain: string | null;
  provenance: InternalDomainProvenance | null;
}

export interface ProjectConnectionsRepo {
  getActiveForProject(projectId: string): Promise<ConnectionSummary | null>;

  insertActive(input: InsertActiveConnectionInput): Promise<ConnectionSummary>;

  updateCredential(
    id: string,
    input: { credentialCiphertext: string; credentialKeyId: string },
  ): Promise<ConnectionSummary | null>;

  deactivate(id: string): Promise<ConnectionSummary | null>;
  recordHealth(id: string, input: RecordHealthInput): Promise<ConnectionSummary | null>;

  advanceWatermark(id: string, input: AdvanceWatermarkInput): Promise<ConnectionSummary | null>;

  setBackfillCursor(id: string, backfillBefore: string | null): Promise<ConnectionSummary | null>;
  setInferredInternalDomain(
    id: string,
    input: SetInferredInternalDomainInput,
  ): Promise<ConnectionSummary | null>;
}

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
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  const candidate = (cause ?? error) as DriverErrorFields | null | undefined;
  return candidate ?? {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

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

    async setBackfillCursor(
      id: string,
      backfillBefore: string | null,
    ): Promise<ConnectionSummary | null> {
      const [row] = await db
        .update(projectConnections)
        .set({ backfillBefore })
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
