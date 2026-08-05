import { randomBytes } from "node:crypto";

import {
  hashWriteKeyMaterial,
  isWriteKeyFormat,
  memberUserId,
  WRITE_KEY_PREFIX,
  type TenantContext,
  type WriteKeyKind,
  type WriteKeyMetadata,
} from "@growthmind/shared";
import { and, eq, isNull, sql } from "drizzle-orm";

import { writeKeys } from "../schema/write-keys";
import { orgCrud } from "./crud";
import { scoped } from "./scope";
import type { ScopedDb, ScopedExecutor } from "./types";

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

export function createWriteKeysRepo(db: ScopedExecutor, ctx: TenantContext): WriteKeysRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, writeKeys);

  return {
    async mint(input: { projectId: string; kind: WriteKeyKind }): Promise<MintedWriteKey> {
      await s.assertProjectOwned(
        input.projectId,
        () => new Error("project not found in this organization"),
      );

      const raw = generateRawKeyMaterial();
      const keyHash = hashWriteKeyMaterial(raw);
      const keyPrefix = raw.slice(0, 12);

      const row = await c.insert({
        projectId: input.projectId,
        kind: input.kind,
        keyHash,
        keyPrefix,
        createdByUserId: memberUserId(ctx),
        revokedAt: null,
      });

      return { raw, key: toMetadata(row) };
    },

    async listByProject(projectId: string): Promise<WriteKeyMetadata[]> {
      const rows = await c.list({ where: eq(writeKeys.projectId, projectId) });

      return rows.map(toMetadata);
    },

    async revoke(id: string): Promise<WriteKeyMetadata | null> {
      // `coalesce` so a second revoke keeps the first revocation's timestamp.
      const row = await c.update(
        { revokedAt: sql`coalesce(${writeKeys.revokedAt}, now())` },
        eq(writeKeys.id, id),
      );

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
