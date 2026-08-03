import type {
  ConnectionHealth,
  ConnectionSummary,
  InternalDomainProvenance,
  SessionSourceKind,
  SourceFailureCode,
  TenantContext,
} from "@growthmind/shared";
import { eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import { projectConnections } from "../schema/project-connections";
import { orgCrud } from "./crud";
import { RepoWriteError, rethrowScrubbed } from "./driver-error";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

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

export class ConnectionWriteError extends RepoWriteError {}

function rethrowWithoutParameters(error: unknown, secrets: readonly string[]): never {
  rethrowScrubbed(
    error,
    secrets,
    (message, code, constraint) => new ConnectionWriteError(message, code, constraint),
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
  db: ScopedExecutor,
  ctx: TenantContext,
): ProjectConnectionsRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, projectConnections);

  const notOurProject = () =>
    new ConnectionWriteError("project not found in this organization", null, null);

  async function updateById(
    id: string,
    set: PgUpdateSetSource<typeof projectConnections>,
  ): Promise<ConnectionSummary | null> {
    const row = await c.update(set, eq(projectConnections.id, id));

    return row ? toConnectionSummary(row) : null;
  }

  return {
    async getActiveForProject(projectId: string): Promise<ConnectionSummary | null> {
      const row = await c.maybe(
        eq(projectConnections.projectId, projectId),
        eq(projectConnections.isActive, true),
      );

      return row ? toConnectionSummary(row) : null;
    },

    async insertActive(input: InsertActiveConnectionInput): Promise<ConnectionSummary> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      try {
        const row = await c.insert({
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
        });

        return toConnectionSummary(row);
      } catch (error) {
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async updateCredential(
      id: string,
      input: { credentialCiphertext: string; credentialKeyId: string },
    ): Promise<ConnectionSummary | null> {
      try {
        return await updateById(id, {
          credentialCiphertext: input.credentialCiphertext,
          credentialKeyId: input.credentialKeyId,
        });
      } catch (error) {
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async deactivate(id: string): Promise<ConnectionSummary | null> {
      return updateById(id, { isActive: false, health: "disconnected" });
    },

    async recordHealth(id: string, input: RecordHealthInput): Promise<ConnectionSummary | null> {
      return updateById(id, {
        health: input.health,
        healthReasonCode: input.reasonCode,
        healthReasonMessage: input.reasonMessage,
        healthCheckedAt: input.checkedAt,
      });
    },

    async advanceWatermark(
      id: string,
      input: AdvanceWatermarkInput,
    ): Promise<ConnectionSummary | null> {
      return updateById(id, {
        watermarkAt: sql`greatest(${projectConnections.watermarkAt}, ${input.watermarkAt}::timestamptz)`,
        backfillBefore: input.backfillBefore,
      });
    },

    async setBackfillCursor(
      id: string,
      backfillBefore: string | null,
    ): Promise<ConnectionSummary | null> {
      return updateById(id, { backfillBefore });
    },

    async setInferredInternalDomain(
      id: string,
      input: SetInferredInternalDomainInput,
    ): Promise<ConnectionSummary | null> {
      return updateById(id, {
        inferredInternalDomain: input.domain,
        internalDomainProvenance: input.provenance,
      });
    },
  };
}
