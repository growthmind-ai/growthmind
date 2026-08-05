import { createPostHogReplaySource } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import { createProjectConnectionsRepo } from "@growthmind/db";
import { listAnalysableProjects } from "@growthmind/db/system";
import type { CredentialKey, CredentialKeyResolution, TenantContext } from "@growthmind/shared";
import { deriveIdentityHmacKey, logger } from "@growthmind/shared";

import type { AnalysisLogger } from "./analysis/types";
import type {
  ReplayLane,
  ReplayLaneSource,
  ResolvedReplaySource,
} from "./tasks/replay-narration-tick";

const CONNECT_BACKOFF_CEILING_MS = 5_000;

export interface ReplayLaneSourceDeps {
  readonly db: ScopedDb;
  readonly logger: AnalysisLogger;
}

export function createReplayLaneSource(deps: ReplayLaneSourceDeps): ReplayLaneSource {
  return {
    async listDueLanes(): Promise<readonly ReplayLane[]> {
      try {
        return await listAnalysableProjects(deps.db);
      } catch (error) {
        deps.logger.error(
          `replay lane source: the project list could not be read this tick: ` +
            `${error instanceof Error ? error.message : "unknown error"}`,
        );
        return [];
      }
    },
  };
}

// The worker's twin of apps/web/lib/replay/deps.ts: one source per organization, built here
// and nowhere else, so the personal API key never crosses into a task.
export function makeReplaySourceFor(
  db: ScopedDb,
  resolution: CredentialKeyResolution,
  fetchImpl: typeof globalThis.fetch,
): (ctx: TenantContext, projectId: string) => Promise<ResolvedReplaySource> {
  if (!resolution.ok) {
    logger.error(
      `replay narration composition: the credential key could not be resolved ` +
        `(${resolution.reason}), so no organization's recordings can be summarised`,
    );
    return () => Promise.resolve({ ok: false, code: "not_configured" });
  }

  const key: CredentialKey = resolution.key;

  return async (ctx, projectId) => {
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
        `replay narration composition: org ${ctx.organizationId} has a stored analytics ` +
          `credential this installation cannot open (${opened.reason}) — it must be reconnected`,
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
