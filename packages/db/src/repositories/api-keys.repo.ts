import { randomBytes, randomUUID } from "node:crypto";

import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  buildAgentFirstContactDedupKey,
  buildKeyCreatedDedupKey,
  buildKeysRevokedDedupKey,
  hashApiKeyMaterial,
  isApiKeyFormat,
  memberUserId,
  type ApiKeyMetadata,
  type ApiKeyUseSummary,
  type MachineRole,
  type TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { publishLive } from "../live/publish";
import { emitNotification } from "../notifications/emit";
import { apiKeys } from "../schema/api-keys";
import { organization } from "../schema/auth";
import { inTransaction, orgCrud } from "./crud";
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

      // The actor comes from the context, never from an argument: a `createdByUserId`
      // parameter is a wire a caller can forget, and the one value it could carry wrongly is
      // a machine principal's synthetic id, which this column's foreign key would reject.
      const row = await inTransaction(db, async (tx) => {
        const inserted = await orgCrud(tx, ctx, apiKeys).insert({
          name: input.name,
          keyHash,
          keyPrefix,
          createdByUserId: memberUserId(ctx),
          revokedAt: null,
        });

        // The payload arm carries nothing but its discriminant, so neither the raw key nor
        // its hash has a field to ride in (ADD §4.1, AC-11).
        await emitNotification(tx, ctx.organizationId, {
          type: "key_created",
          subjectKind: "agent_key",
          subjectId: inserted.id,
          actorUserId: memberUserId(ctx),
          payload: { type: "key_created", v: 1 },
          dedupKey: buildKeyCreatedDedupKey(inserted.id),
          slack: { kind: "owed" },
        });

        return inserted;
      });

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
      // The transition and its announcement land together: the UPDATE returning a row is
      // what makes one real revocation one notification, and the disclosure now reaches the
      // whole org rather than only the person who pressed it (B-055, ADD §4 seam 2).
      const row = await inTransaction(db, async (tx) => {
        const revoked = await orgCrud(tx, ctx, apiKeys).update(
          { revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` },
          isNull(apiKeys.revokedAt),
        );

        if (revoked !== null) {
          // Minted here rather than derived from a key: key ids churn through revoke and
          // re-mint, and a churning input inside a dedup key forks the identity (D12).
          const eventId = randomUUID();

          await emitNotification(tx, ctx.organizationId, {
            type: "keys_revoked",
            subjectKind: "agent_key",
            subjectId: eventId,
            actorUserId: memberUserId(ctx),
            payload: { type: "keys_revoked", v: 1 },
            dedupKey: buildKeysRevokedDedupKey(eventId),
            slack: { kind: "owed" },
          });
        }

        return revoked;
      });

      return row !== null;
    },
  };
}

export const API_KEY_ACTOR_PREFIX = "api-key:";

export const API_KEY_ACTOR_ROLE = "api_key" satisfies MachineRole;

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
  await inTransaction(db, async (tx) => {
    const stamped = await tx
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiKeys.id, keyId),
          isNull(apiKeys.revokedAt),
          sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - make_interval(secs => ${API_KEY_USE_STAMP_INTERVAL_SECONDS}))`,
        ),
      )
      .returning();

    // A first call from someone's coding assistant is the moment the setup panel is waiting
    // for, and it arrives on a request nobody in a browser made.
    const row = stamped[0];
    if (row === undefined) {
      return;
    }

    await publishLive(tx, { organizationId: row.organizationId, topic: "agent_connection" });

    // This statement re-fires every stamp interval for the life of the key, so once-ever
    // rests entirely on the dedup key: every call after the first conflicts and returns
    // without a row, a job or a publish. The organization comes off the row rather than a
    // context — this path authenticates a machine, and there is no member to carry one.
    await emitNotification(tx, row.organizationId, {
      type: "agent_first_contact",
      subjectKind: "agent_key",
      subjectId: keyId,
      actorUserId: null,
      payload: { type: "agent_first_contact", v: 1 },
      dedupKey: buildAgentFirstContactDedupKey(),
      slack: { kind: "owed" },
    });
  });
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
