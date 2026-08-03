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
import { organization } from "../schema/auth";
import { orgCrud } from "./crud";
import type { ScopedDb, ScopedExecutor } from "./types";

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

export function createApiKeysRepo(db: ScopedExecutor, ctx: TenantContext): ApiKeysRepo {
  const c = orgCrud(db, ctx, apiKeys);

  return {
    async mint(input: { name: string }): Promise<MintedApiKey> {
      const raw = generateRawKeyMaterial();
      const keyHash = hashApiKeyMaterial(raw);
      const keyPrefix = raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);

      const row = await c.insert({ name: input.name, keyHash, keyPrefix, revokedAt: null });

      return { raw, key: toMetadata(row) };
    },

    async list(): Promise<ApiKeyMetadata[]> {
      const rows = await c.list({ orderBy: [desc(apiKeys.createdAt)] });

      return rows.map(toMetadata);
    },

    async revoke(id: string): Promise<ApiKeyMetadata | null> {
      // `coalesce` so a second revoke keeps the first revocation's timestamp.
      const row = await c.update(
        { revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` },
        eq(apiKeys.id, id),
      );

      return row ? toMetadata(row) : null;
    },
  };
}

export const API_KEY_ACTOR_PREFIX = "api-key:";

export const API_KEY_ACTOR_ROLE = "api_key";

// The organization is read out of the database, keyed by the digest of an unforgeable
// secret, so no caller can name the tenancy it acts in.
export async function resolveApiKeyPrincipal(
  db: ScopedDb,
  presented: string,
): Promise<TenantContext | null> {
  if (!isApiKeyFormat(presented)) {
    return null;
  }

  const keyHash = hashApiKeyMaterial(presented);

  const [row] = await db
    .select({
      keyId: apiKeys.id,
      organizationId: apiKeys.organizationId,
      organizationName: organization.name,
    })
    .from(apiKeys)
    .innerJoin(organization, eq(apiKeys.organizationId, organization.id))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    userId: `${API_KEY_ACTOR_PREFIX}${row.keyId}`,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: API_KEY_ACTOR_ROLE,
  };
}
