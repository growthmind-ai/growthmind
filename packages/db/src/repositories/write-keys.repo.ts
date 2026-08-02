import { randomBytes } from "node:crypto";

import {
  hashWriteKeyMaterial,
  isWriteKeyFormat,
  WRITE_KEY_PREFIX,
  type TenantContext,
  type WriteKeyKind,
  type WriteKeyMetadata,
} from "@growthmind/shared";
import { and, eq, isNull } from "drizzle-orm";

import { projects } from "../schema/projects";
import { writeKeys } from "../schema/write-keys";
import type { ScopedDb } from "./types";

export type WriteKeyRow = typeof writeKeys.$inferSelect;

function toMetadata(row: WriteKeyRow): WriteKeyMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    organizationId: row.organizationId,
    kind: row.kind,
    keyPrefix: row.keyPrefix,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function generateRawKeyMaterial(): string {
  return `${WRITE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface MintedWriteKey {
  raw: string;
  key: WriteKeyMetadata;
}

export interface WriteKeysRepo {
  mint(input: { projectId: string; kind: WriteKeyKind }): Promise<MintedWriteKey>;

  listByProject(projectId: string): Promise<WriteKeyMetadata[]>;

  revoke(id: string): Promise<WriteKeyMetadata | null>;
}

export function createWriteKeysRepo(db: ScopedDb, ctx: TenantContext): WriteKeysRepo {
  return {
    async mint(input: { projectId: string; kind: WriteKeyKind }): Promise<MintedWriteKey> {
      const [ownedProject] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, input.projectId), eq(projects.organizationId, ctx.organizationId)),
        )
        .limit(1);

      if (!ownedProject) {
        throw new Error("project not found in this organization");
      }

      const raw = generateRawKeyMaterial();
      const keyHash = hashWriteKeyMaterial(raw);
      const keyPrefix = raw.slice(0, 12);

      const [row] = await db
        .insert(writeKeys)
        .values({
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          kind: input.kind,
          keyHash,
          keyPrefix,
          revokedAt: null,
        })
        .returning();

      if (!row) {
        throw new Error("mint: insert returned no row");
      }

      return { raw, key: toMetadata(row) };
    },

    async listByProject(projectId: string): Promise<WriteKeyMetadata[]> {
      const rows = await db
        .select()
        .from(writeKeys)
        .where(
          and(eq(writeKeys.organizationId, ctx.organizationId), eq(writeKeys.projectId, projectId)),
        );

      return rows.map(toMetadata);
    },

    async revoke(id: string): Promise<WriteKeyMetadata | null> {
      const [row] = await db
        .update(writeKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(writeKeys.organizationId, ctx.organizationId), eq(writeKeys.id, id)))
        .returning();

      return row ? toMetadata(row) : null;
    },
  };
}

export async function resolveWriteKeyForIngest(
  db: ScopedDb,
  presented: string,
): Promise<{ projectId: string; organizationId: string; kind: WriteKeyKind } | null> {
  if (!isWriteKeyFormat(presented)) {
    return null;
  }

  const keyHash = hashWriteKeyMaterial(presented);

  const [row] = await db
    .select()
    .from(writeKeys)
    .where(and(eq(writeKeys.keyHash, keyHash), isNull(writeKeys.revokedAt)))
    .limit(1);

  if (!row) {
    return null;
  }

  return { projectId: row.projectId, organizationId: row.organizationId, kind: row.kind };
}
