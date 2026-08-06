import type { ReplaySource } from "@growthmind/adapters";
import { createPostHogReplaySource } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import { createProjectConnectionsRepo, findFirstProjectForOrg } from "@growthmind/db";
import type { CredentialKeyResolution, DecryptResult, TenantContext } from "@growthmind/shared";
import { logger, parseWebEnv, resolveCredentialKey } from "@growthmind/shared";

import { createPostHogAdapterDeps } from "@/lib/adapter-deps";
import { whenCredentialResolved } from "@/lib/credential-port";
import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

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
  return whenCredentialResolved<TenantContext, ReplaySourceResolution>(
    resolution,
    "replay composition",
    "no organization's recordings can be read",
    { ok: false, code: "not_configured" },
    (key) => async (ctx) => {
      // Reading recordings must not provision anything. No project yet means nothing has
      // been connected yet, which is the answer the connection lookup below would give anyway.
      const project = await findFirstProjectForOrg(db, ctx);
      if (project === undefined) {
        return { ok: false, code: "no_connection" };
      }

      const projectId = project.id;
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
        createPostHogAdapterDeps(key, fetchImpl),
      );

      return { ok: true, source };
    },
  );
}

export function resolveReplayDeps(db: ScopedDb = getDb()): ReplayRouteDeps {
  const env = parseWebEnv(process.env);

  return {
    db,
    tenant: getTenantContext,
    sourceFor: makeSourceFor(db, resolveCredentialKey(env), globalThis.fetch),
  };
}

export type RecordingSourceState =
  | "ready"
  | "no_connection"
  | "unreadable_credential"
  | "not_configured";

export interface RecordingSourceQuery {
  readonly ctx: TenantContext;
  readonly projectId: string;
}

export type RecordingSourceStateFor = (query: RecordingSourceQuery) => Promise<RecordingSourceState>;

export function recordingSourceStateOf(opened: DecryptResult | null): RecordingSourceState {
  if (opened === null) {
    return "no_connection";
  }

  return opened.ok ? "ready" : "unreadable_credential";
}

// AD-6: `sourceFor` answers a bigger question at three round trips and a source object. This
// answers only what a recording card asks, at one query and one local decrypt, and is called
// only when there is no summary row yet.
export function makeRecordingSourceState(
  db: ScopedDb,
  resolution: CredentialKeyResolution,
): RecordingSourceStateFor {
  return whenCredentialResolved<RecordingSourceQuery, RecordingSourceState>(
    resolution,
    "recording source state",
    "no organization's recording state can be read",
    "not_configured",
    (key) =>
      async ({ ctx, projectId }) => {
        const opened = await createProjectConnectionsRepo(db, ctx).openCredentialForProject(
          projectId,
          key,
        );

        if (opened !== null && !opened.ok) {
          logger.error(
            `recording source state: org ${ctx.organizationId} has a stored analytics credential ` +
              `this installation cannot open (${opened.reason}) — it must be reconnected`,
          );
        }

        return recordingSourceStateOf(opened);
      },
  );
}

export function resolveRecordingSourceState(db: ScopedDb = getDb()): RecordingSourceStateFor {
  return makeRecordingSourceState(db, resolveCredentialKey(parseWebEnv(process.env)));
}
