import { randomBytes } from "node:crypto";

import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  hashApiKeyMaterial,
  isApiKeyFormat,
  type ApiKeyMetadata,
  type ApiKeyUseSummary,
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
    lastUsedAt: row.lastUsedAt,
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

  liveKeyUse(): Promise<ApiKeyUseSummary>;

  revoke(id: string): Promise<ApiKeyMetadata | null>;

  revokeEveryLive(): Promise<boolean>;
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

    async liveKeyUse(): Promise<ApiKeyUseSummary> {
      const rows = await c.list({ where: isNull(apiKeys.revokedAt) });

      return {
        liveCount: rows.length,
        anyUsed: rows.some((row) => row.lastUsedAt !== null),
      };
    },

    async revoke(id: string): Promise<ApiKeyMetadata | null> {
      // `coalesce` so a second revoke keeps the first revocation's timestamp.
      const row = await c.update(
        { revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` },
        eq(apiKeys.id, id),
      );

      return row ? toMetadata(row) : null;
    },

    // No id parameter: `orgCrud.update` injects the organisation filter, so there is
    // nowhere for a caller-supplied key id to enter this path.
    async revokeEveryLive(): Promise<boolean> {
      const row = await c.update(
        { revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` },
        isNull(apiKeys.revokedAt),
      );

      return row !== null;
    },
  };
}

export const API_KEY_ACTOR_PREFIX = "api-key:";

export const API_KEY_ACTOR_ROLE = "api_key";

export const API_KEY_USE_STAMP_INTERVAL_SECONDS = 300;

// The other half of the `api-key:<id>` encoding two lines up, so no call site slices
// the prefix off by hand.
export function apiKeyIdOf(ctx: TenantContext): string | null {
  if (!ctx.userId.startsWith(API_KEY_ACTOR_PREFIX)) {
    return null;
  }

  const id = ctx.userId.slice(API_KEY_ACTOR_PREFIX.length);

  return id.length > 0 ? id : null;
}

// Unconditional in the application, conditional in the statement: the first call on a
// key always writes, and the database decides every call after that.
export async function stampApiKeyUse(db: ScopedDb, keyId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, keyId),
        isNull(apiKeys.revokedAt),
        sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - make_interval(secs => ${API_KEY_USE_STAMP_INTERVAL_SECONDS}))`,
      ),
    );
}

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
