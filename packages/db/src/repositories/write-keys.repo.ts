// Repository for the `write_keys` table. D-B: the scoped factory takes a
// `TenantContext` at construction; no method below accepts an organization
// id as a parameter. `write_keys` is dual-stamped (`organizationId` AND
// `projectId`, D-F) so every mutation keys on `(ctx.organizationId, id)`
// with `.returning()` — a foreign-org id affects zero rows and returns
// `null`, never a silent success.
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

/** Raw persisted row shape — includes `keyHash`, unlike `WriteKeyMetadata`.
 * A later wave maps this to the DTO at the repository boundary; never
 * return this type directly from a repository method. */
export type WriteKeyRow = typeof writeKeys.$inferSelect;

/** Maps a persisted row to the metadata DTO boundary (FR-7) — built as an
 * explicit field-by-field pick, never a spread/cast, so `keyHash` (and any
 * future sensitive column) cannot leak through by accident. */
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

/** Generates raw write-key material in the D-F shape: `WRITE_KEY_PREFIX` +
 * 43 base64url chars (256-bit random). */
function generateRawKeyMaterial(): string {
  return `${WRITE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface MintedWriteKey {
  /** Raw key material — returned exactly once, from `mint()` only. Never
   * persisted, logged, or included in any DTO (FR-7). */
  raw: string;
  key: WriteKeyMetadata;
}

export interface WriteKeysRepo {
  /**
   * Mints a new write key for `projectId`. Must verify `projectId` belongs
   * to `ctx.organizationId` before minting — a client-supplied project id
   * must never widen access to a foreign org's project (FR-8d). Generates
   * key material, persists only its hash + prefix (never the raw material),
   * and returns the raw material exactly once alongside the metadata DTO.
   */
  mint(input: { projectId: string; kind: WriteKeyKind }): Promise<MintedWriteKey>;
  /** Metadata only (never hash, never raw material), org- and
   * project-filtered. */
  listByProject(projectId: string): Promise<WriteKeyMetadata[]>;
  /**
   * Keyed on `(ctx.organizationId, id)` with `.returning()` — `null` when 0
   * rows match, e.g. a foreign org's key id.
   */
  revoke(id: string): Promise<WriteKeyMetadata | null>;
}

export function createWriteKeysRepo(db: ScopedDb, ctx: TenantContext): WriteKeysRepo {
  return {
    async mint(input: { projectId: string; kind: WriteKeyKind }): Promise<MintedWriteKey> {
      // FR-8(d): verify the client-supplied projectId belongs to THIS
      // organization before minting anything — a foreign-org project id
      // must never widen access at the service edge.
      const [ownedProject] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, ctx.organizationId)))
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
        .where(and(eq(writeKeys.organizationId, ctx.organizationId), eq(writeKeys.projectId, projectId)));

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

/**
 * D-B's one designed exception to "no method accepts an org id as a
 * parameter" — and it does not, either: this function takes NO tenant
 * context and NO organization id at all. Write-key resolution for ingest is
 * credential-scoped, not session-scoped — the presented key material *is*
 * the tenant proof for machine callers (architecture §4.2), so there is no
 * session to derive a `TenantContext` from in the first place.
 *
 * Contract:
 * - Performs NO mutations — a read-only lookup by key hash.
 * - Exported separately from the scoped repository factories above (never
 *   folded into `WriteKeysRepo`) so it can never be reached by constructing
 *   a `TenantContext`-scoped repo.
 * - Unreachable from any user-triggered path this sprint — nothing calls it
 *   except its own tests until O-003 wires it into the real ingest route.
 * - Fail-closed (D10): unknown, malformed, or revoked keys resolve to
 *   `null`. Never a default project, never a best-effort match.
 */
export async function resolveWriteKeyForIngest(
  db: ScopedDb,
  presented: string,
): Promise<{ projectId: string; organizationId: string; kind: WriteKeyKind } | null> {
  // D10 fail-closed: reject malformed/empty input BEFORE ever touching the
  // DB — never a best-effort lookup on a syntactically invalid key.
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
