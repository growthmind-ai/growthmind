import { randomBytes } from "node:crypto";

import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  hashApiKeyMaterial,
  isApiKeyFormat,
  type ApiKeyMetadata,
  type TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { apiKeys } from "../schema/api-keys";
import { scoped } from "./scope";
import type { ScopedDb } from "./types";

export type ApiKeyRow = typeof apiKeys.$inferSelect;

function toMetadata(row: ApiKeyRow): ApiKeyMetadata {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function generateRawKeyMaterial(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface MintedApiKey {
  raw: string;
  key: ApiKeyMetadata;
}

export interface ApiKeysRepo {
  mint(input: { name: string }): Promise<MintedApiKey>;

  list(): Promise<ApiKeyMetadata[]>;

  revoke(id: string): Promise<ApiKeyMetadata | null>;
}

export function createApiKeysRepo(db: ScopedDb, ctx: TenantContext): ApiKeysRepo {
  const s = scoped(db, ctx);

  return {
    async mint(input: { name: string }): Promise<MintedApiKey> {
      const raw = generateRawKeyMaterial();
      const keyHash = hashApiKeyMaterial(raw);
      const keyPrefix = raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);

      const rows = await db
        .insert(apiKeys)
        .values({ ...s.stamp, name: input.name, keyHash, keyPrefix, revokedAt: null })
        .returning();

      return { raw, key: toMetadata(s.one(rows, "createApiKeysRepo.mint")) };
    },

    async list(): Promise<ApiKeyMetadata[]> {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(s.org(apiKeys))
        .orderBy(desc(apiKeys.createdAt));

      return rows.map(toMetadata);
    },

    async revoke(id: string): Promise<ApiKeyMetadata | null> {
      const row = s.maybe(
        await db
          .update(apiKeys)
          // `coalesce` so a second revoke keeps the first revocation's timestamp.
          // `write-keys.repo.ts:revoke` assigns `new Date` and does not preserve it.
          .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` })
          .where(s.owned(apiKeys, eq(apiKeys.id, id)))
          .returning(),
      );

      return row ? toMetadata(row) : null;
    },
  };
}

export interface ResolvedApiKey {
  readonly organizationId: string;
}

export async function resolveApiKeyForRead(
  db: ScopedDb,
  presented: string,
): Promise<ResolvedApiKey | null> {
  if (!isApiKeyFormat(presented)) {
    return null;
  }

  const keyHash = hashApiKeyMaterial(presented);

  const [row] = await db
    .select({ organizationId: apiKeys.organizationId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) {
    return null;
  }

  return { organizationId: row.organizationId };
}
