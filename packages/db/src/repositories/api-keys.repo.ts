// Repository for the `api_keys` table. The read credential a person mints and hands to
// their coding agent.
//
// The scoped factory takes a `TenantContext` at construction; no method below accepts
// an organisation id as a parameter. `api_keys` is stamped with an organisation and
// nothing else. There is no `projectId` here and no project ownership pre-check, unlike
// `write-keys.repo.ts`. A read credential addresses one organisation's findings, so a
// project is neither stamped nor filtered anywhere in this file (the schema header
// carries the argument).
//
// Every mutation keys on `(ctx.organizationId, id)` with `.returning`, so a foreign
// or nonexistent id affects zero rows and returns `null`. Nothing revoked, nothing
// mutated, no silent success.
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
import type { ScopedDb } from "./types";

/** Raw persisted row shape. Includes `keyHash`, unlike `ApiKeyMetadata`. Never return
 * this type from a repository method; map it at the boundary. */
export type ApiKeyRow = typeof apiKeys.$inferSelect;

/** Maps a persisted row to the metadata DTO boundary. Built as an explicit
 * field-by-field pick, never a spread/cast, so `keyHash` (and any future sensitive
 * column) cannot leak through by accident. */
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

/** Generates raw credential material: `API_KEY_PREFIX` + 43 base64url chars (256-bit
 * random). Unexported, nothing outside `mint` may produce credential material. */
function generateRawKeyMaterial(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface MintedApiKey {
  /** Raw credential material, returned exactly once, from `mint` only. Never
   * persisted, never logged, never included in any DTO. The operator copies it from the
   * terminal or it is gone. */
  raw: string;
  key: ApiKeyMetadata;
}

export interface ApiKeysRepo {
  /**
   * Mints a read credential for `ctx.organizationId`. Persists only the digest and the
   * display prefix, and returns the raw material exactly once.
   *
   * One `INSERT … RETURNING`, no read-then-write anywhere, so there is nothing to
   * serialise between two concurrent mints, and the unique index on `key_hash` makes
   * the (astronomically unlikely) collision an error rather than a silent overwrite.
   */
  mint(input: { name: string }): Promise<MintedApiKey>;
  /** Metadata only (never the hash, never the material), org-filtered. Revoked rows are
   * included: an operator needs to see that the key they revoked is the one that is
   * gone. */
  list(): Promise<ApiKeyMetadata[]>;
  /**
   * Keyed on `(ctx.organizationId, id)` with `.returning`, `null` when zero rows
   * match, e.g. another organisation's key id or one that never existed. The caller
   * reads that `null` as "nothing was revoked" and exits non-zero; a zero-row write
   * reported as success is the exact class the retro named critical.
   *
   * Revoking an already-revoked key succeeds and returns the row, but preserves the
   * first revocation's `revokedAt`, two operators racing to kill a leaked credential
   * must not rewrite the record of when it stopped working.
   */
  revoke(id: string): Promise<ApiKeyMetadata | null>;
}

export function createApiKeysRepo(db: ScopedDb, ctx: TenantContext): ApiKeysRepo {
  return {
    async mint(input: { name: string }): Promise<MintedApiKey> {
      const raw = generateRawKeyMaterial();
      const keyHash = hashApiKeyMaterial(raw);
      const keyPrefix = raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);

      const [row] = await db
        .insert(apiKeys)
        .values({
          organizationId: ctx.organizationId,
          name: input.name,
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

    async list(): Promise<ApiKeyMetadata[]> {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, ctx.organizationId))
        .orderBy(desc(apiKeys.createdAt));

      return rows.map(toMetadata);
    },

    async revoke(id: string): Promise<ApiKeyMetadata | null> {
      const [row] = await db
        .update(apiKeys)
        // `coalesce`, not `new Date`: the first revocation's timestamp is the one
        // audit fact this table holds about a credential, and a second revoke must not
        // rewrite it. Two operators racing to kill a leaked key is the ordinary case,
        // not a contrived one. A plain assignment would move the timestamp forward and
        // the CLI would report the later run as a fresh revocation, quietly erasing
        // when the key actually stopped working. Still one atomic `UPDATE … RETURNING`,
        // so the second call stays honest without becoming an error: the key is
        // revoked, the caller is told so, and the row comes back carrying the original
        // time.
        //
        // This diverges deliberately from `write-keys.repo.ts:revoke`, which still
        // assigns `new Date`. The read family is the one where the timestamp matters.
        // A read credential is what a person mints, hands to an agent, and later has to
        // answer "when did we cut this off?" about. If write keys ever grow the same
        // question, they should move here rather than this moving back.
        .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` })
        .where(and(eq(apiKeys.organizationId, ctx.organizationId), eq(apiKeys.id, id)))
        .returning();

      return row ? toMetadata(row) : null;
    },
  };
}

/** What a presented credential resolves to, and all it resolves to: the organisation.
 * Every downstream read scopes to this id, never to anything in the request. */
export interface ResolvedApiKey {
  readonly organizationId: string;
}

/**
 * the designed exception to "no method accepts an org id as a parameter", and it does
 * not, either: this function takes NO tenant context and NO organisation id at all.
 * Read-credential resolution is credential-scoped, not session-scoped. The presented
 * material *is* the tenant proof for machine callers (architecture), so there is no
 * session to derive a `TenantContext` from in the first place. That is why the
 * taxonomy's rule ("a hand-written query must carry its own org filter") is answered
 * here by the unique index on `key_hash` plus `isNull(revoked_at)` in one predicate,
 * and not by a filter this function has no way to obtain. Read that as a documented
 * exception, not an unreviewed hole.
 *
 * Contract, mirroring `resolveWriteKeyForIngest` (write-keys.repo.ts:157-180) line for
 * line:
 * Performs NO mutations. A read-only lookup by key hash.
 * Exported separately from the scoped factory above (never folded into `ApiKeysRepo`)
 *  so it can never be reached by constructing a scoped repo.
 * Fail-closed: unknown, malformed, or revoked material resolves to `null`. Never a
 *  default organisation, never a best-effort match, never a distinguishable refusal.
 * The revocation filter shares one `where` with the hash lookup. Not a second query,
 *  not a post-filter: a fetch-then-check makes a revoked credential and an unknown one
 *  distinguishable by time even when the answers are identical.
 * The projection is narrow (the organisation id, never the row) so no column of this
 *  table can ride out through a caller that spreads the result.
 */
export async function resolveApiKeyForRead(
  db: ScopedDb,
  presented: string,
): Promise<ResolvedApiKey | null> {
  // fail-closed: refuse malformed/empty input before ever touching the database, never
  // a best-effort lookup on a syntactically invalid credential, and no query issued on
  // hostile input.
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
