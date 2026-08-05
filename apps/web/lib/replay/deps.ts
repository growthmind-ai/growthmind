import type { ReplaySource } from "@growthmind/adapters";
import { createPostHogReplaySource } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import { createProjectConnectionsRepo, ensureProject } from "@growthmind/db";
import type { CredentialKey, CredentialKeyResolution, TenantContext } from "@growthmind/shared";
import {
  deriveIdentityHmacKey,
  logger,
  parseWebEnv,
  resolveCredentialKey,
} from "@growthmind/shared";

import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

const CONNECT_BACKOFF_CEILING_MS = 5_000;

export type ReplaySourceRefusal = "no_connection" | "unreadable_credential" | "not_configured";

export type ReplaySourceResolution =
  | { readonly ok: true; readonly source: ReplaySource }
  | { readonly ok: false; readonly code: ReplaySourceRefusal };

// A source per organization, built here and nowhere else, exactly like `posterFor` and
// `channelsFor` in lib/first-run/deps.ts (AD-20, D7). The routes receive a port; the
// personal API key never crosses back to them and cannot.
export type ReplaySourceFor = (ctx: TenantContext) => Promise<ReplaySourceResolution>;

export interface ReplayRouteDeps {
  readonly db: ScopedDb;
  readonly tenant: () => Promise<TenantContext | null>;
  readonly sourceFor: ReplaySourceFor;
}

function makeSourceFor(
  db: ScopedDb,
  resolution: CredentialKeyResolution,
  fetchImpl: typeof globalThis.fetch,
): ReplaySourceFor {
  if (!resolution.ok) {
    logger.error(
      `replay composition: the credential key could not be resolved (${resolution.reason}), ` +
        `so no organization's recordings can be read on this installation until it is configured`,
    );
    return () => Promise.resolve({ ok: false, code: "not_configured" });
  }

  const key: CredentialKey = resolution.key;

  return async (ctx) => {
    const { projectId } = await ensureProject(db, ctx);
    const repo = createProjectConnectionsRepo(db, ctx);

    const connection = await repo.getActiveForProject(projectId);
    if (connection === null) {
      return { ok: false, code: "no_connection" };
    }

    const opened = await repo.openCredentialForProject(projectId, key);
    if (opened === null) {
      return { ok: false, code: "no_connection" };
    }

    if (!opened.ok) {
      logger.error(
        `replay composition: org ${ctx.organizationId} has a stored analytics credential this ` +
          `installation cannot open (${opened.reason}) — it must be reconnected`,
      );
      return { ok: false, code: "unreadable_credential" };
    }

    const source = createPostHogReplaySource(
      {
        host: connection.host,
        sourceProjectId: connection.sourceProjectId,
        personalApiKey: opened.value,
      },
      {
        fetch: fetchImpl,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        now: () => new Date(),
        random: () => Math.random(),
        identityHmacKey: deriveIdentityHmacKey(key),
        deadlineExceededAfter: (ms) => ms > CONNECT_BACKOFF_CEILING_MS,
      },
    );

    return { ok: true, source };
  };
}

export function resolveReplayDeps(db: ScopedDb = getDb()): ReplayRouteDeps {
  const env = parseWebEnv(process.env);

  return {
    db,
    tenant: getTenantContext,
    sourceFor: makeSourceFor(db, resolveCredentialKey(env), globalThis.fetch),
  };
}
