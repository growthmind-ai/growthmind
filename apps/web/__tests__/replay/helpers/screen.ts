import { randomUUID } from "node:crypto";

import { createSessionsRepo, schema, type RecordingMetaStamp, type ScopedDb } from "@growthmind/db";
import {
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  type TestDb,
} from "@growthmind/db/testing";
import { REPLAY_DEFAULT_LANE } from "@growthmind/shared";
import type {
  Origin,
  ReplayFilters,
  StampedExclusionReason,
  TenantContext,
} from "@growthmind/shared";

import type { ReplayRouteDeps, ReplaySourceResolution } from "../../../lib/replay/deps";
import type { ReplayScreen } from "../../../lib/replay/read";

export interface Workspace {
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly connectionId: string;
}

export interface SessionSpec {
  readonly key: string;
  readonly company?: string | null;
  readonly entry?: string | null;
  readonly origin?: Origin;
  readonly exclusionReason?: StampedExclusionReason;
  readonly startedAt?: Date;
  readonly meta?: RecordingMetaStamp;
}

let workspaces = 0;

function token(label: string): string {
  workspaces += 1;
  return `${label}-${String(workspaces)}`;
}

export async function seedOrgWithoutProject(db: TestDb, label: string): Promise<TenantContext> {
  const name = token(label);
  const org = await seedOrgWithOwner(db, {
    orgName: `web-replay-${name}`,
    userName: `Owner ${name}`,
    email: `owner-${name}@acme-example.test`,
  });

  return org.ctx;
}

export async function seedReplayWorkspace(
  db: TestDb,
  label: string,
  options: { readonly activeConnection?: boolean } = {},
): Promise<Workspace> {
  const name = token(label);
  const org = await seedOrgWithOwner(db, {
    orgName: `web-replay-${name}`,
    userName: `Owner ${name}`,
    email: `owner-${name}@acme-example.test`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `web-replay-${name}`,
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
    isActive: options.activeConnection ?? true,
  });

  return { ctx: org.ctx, projectId: project.id, connectionId: connection.id };
}

// A second member of the same organization, so D1's teammate row reads the org's data
// through its own context rather than the owner's.
export async function seedTeammate(db: TestDb, workspace: Workspace): Promise<TenantContext> {
  const name = token("mate");
  const org = await seedOrgWithOwner(db, {
    orgName: `web-replay-${name}`,
    userName: `Mate ${name}`,
    email: `mate-${name}@acme-example.test`,
  });

  return { ...org.ctx, organizationId: workspace.ctx.organizationId, role: "member" };
}

export async function seedSessions(
  db: TestDb,
  workspace: Workspace,
  specs: readonly SessionSpec[],
): Promise<void> {
  const repo = createSessionsRepo(db, workspace.ctx);

  for (const spec of specs) {
    await seedSession(db, {
      organizationId: workspace.ctx.organizationId,
      projectId: workspace.projectId,
      connectionId: workspace.connectionId,
      sessionKey: spec.key,
      identityEmailDomain: spec.company ?? null,
      entryUrlPath: spec.entry ?? null,
      origin: spec.origin ?? "real",
      exclusionReason: spec.exclusionReason ?? "none",
      ...(spec.startedAt === undefined ? {} : { startedAt: spec.startedAt }),
    });

    if (spec.meta !== undefined) {
      await repo.stampRecordingMeta(workspace.projectId, spec.key, spec.meta);
    }
  }
}

// One statement for a cohort large enough to cross the read cap: 501 sequential inserts
// through seedSession is the difference between a suite that runs and one nobody waits for.
export async function seedSessionCohort(
  db: TestDb,
  workspace: Workspace,
  count: number,
  build: (index: number) => SessionSpec,
): Promise<void> {
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const spec = build(index);
    const startedAt = spec.startedAt ?? new Date(Date.UTC(2026, 7, 1, 0, 0, index % 60));

    rows.push({
      id: randomUUID(),
      organizationId: workspace.ctx.organizationId,
      projectId: workspace.projectId,
      connectionId: workspace.connectionId,
      sessionKey: spec.key,
      identityKey: null,
      identityEmailDomain: spec.company ?? null,
      identityResolution: "unresolved" as const,
      userAgent: null,
      entryUrlPath: spec.entry ?? null,
      startedAt,
      lastEventAt: startedAt,
      origin: spec.origin ?? ("real" as Origin),
      exclusionReason: spec.exclusionReason ?? ("none" as StampedExclusionReason),
      internalDomainAtStamp: null,
      exclusionRuleSetVersion: 1,
      groupingVersion: 1,
    });
  }

  await db.insert(schema.sessions).values(rows);
}

export interface SummarySpec {
  readonly recordingId: string;
  readonly headline: string;
  readonly pages: readonly string[];
  // Left null by default on purpose: 26 of the 64 summaries in production carry no session key,
  // and the list's join must not depend on one.
  readonly sessionKey?: string | null;
}

export async function seedSummaries(
  db: TestDb,
  workspace: Workspace,
  specs: readonly SummarySpec[],
): Promise<void> {
  await db.insert(schema.recordingSummaries).values(
    specs.map((spec) => ({
      id: randomUUID(),
      organizationId: workspace.ctx.organizationId,
      projectId: workspace.projectId,
      recordingId: spec.recordingId,
      summarySource: "model_rendered" as const,
      headline: spec.headline,
      context: [],
      transcript: "",
      pages: spec.pages,
      durationMs: 0,
      actionCount: 0,
      notableCount: 0,
      droppedEvents: 0,
      startedAt: null,
      sessionKey: spec.sessionKey ?? null,
      resolvedModelId: null,
    })),
  );
}

export function filtersOf(overrides: Partial<ReplayFilters> = {}): ReplayFilters {
  return { company: null, entry: null, lane: REPLAY_DEFAULT_LANE, ...overrides };
}

export interface DepsProbe {
  readonly deps: ReplayRouteDeps;
  sourceCalls: () => number;
}

// `sourceFor` is handed over and must never be reached: the connection question is answered
// by one query, not by building a source object (ADD D-7).
export function replayDeps(db: ScopedDb, ctx: TenantContext | null): DepsProbe {
  let calls = 0;

  return {
    deps: {
      db,
      tenant: () => Promise.resolve(ctx),
      sourceFor: () => {
        calls += 1;
        return Promise.resolve<ReplaySourceResolution>({ ok: false, code: "no_connection" });
      },
    },
    sourceCalls: () => calls,
  };
}

export type ReplayScreenView = Extract<ReplayScreen, { kind: "screen" }>;

export function screenOf(result: ReplayScreen): ReplayScreenView {
  if (result.kind !== "screen") {
    throw new Error(`expected a rendered screen, got "${result.kind}"`);
  }

  return result;
}

export function outcomeName(outcome: ReplayScreenView["outcome"]): string {
  return typeof outcome === "string" ? outcome : `relax:${outcome.relax}`;
}

function bind(target: object, property: string | symbol): unknown {
  const value = Reflect.get(target, property, target);

  return typeof value === "function" ? (value as () => unknown).bind(target) : value;
}

export interface ReadProbe {
  readonly db: ScopedDb;
  sessionReads: () => number;
}

// R1 and R2 are two reads of one table, so a failure has to be aimed at one of them: this
// counts selects that reach `sessions` and throws on the nth. Reads of other tables — the
// project and the connection — pass through untouched.
export function failingSessionRead(
  db: TestDb,
  nth: number,
  // Overridable so a caller can fail the read the way drizzle actually fails it, message and all.
  fail: (nth: number) => Error = (n) => new Error(`replay session read ${String(n)} failed`),
): ReadProbe {
  return failingTableRead(db, schema.sessions, nth, fail);
}

export function failingSummaryRead(db: TestDb, nth = 1): ReadProbe {
  return failingTableRead(db, schema.recordingSummaries, nth, (n) => {
    const error = new Error(`replay summary read ${String(n)} failed`);
    error.name = "DrizzleQueryError";
    return error;
  });
}

function failingTableRead(
  db: TestDb,
  wanted: unknown,
  nth: number,
  fail: (nth: number) => Error,
): ReadProbe {
  let reads = 0;

  const proxied = new Proxy(db as object, {
    get(target, property) {
      if (property !== "select") {
        return bind(target, property);
      }

      const select = bind(target, property) as (...args: unknown[]) => object;

      return (...args: unknown[]): object =>
        new Proxy(select(...args), {
          get(builder, builderProperty) {
            if (builderProperty !== "from") {
              return bind(builder, builderProperty);
            }

            const from = bind(builder, builderProperty) as (table: unknown) => unknown;

            return (table: unknown): unknown => {
              if (table === wanted) {
                reads += 1;
                if (reads === nth) {
                  throw fail(nth);
                }
              }

              return from(table);
            };
          },
        });
    },
  });

  return { db: proxied as ScopedDb, sessionReads: () => reads };
}

export function noWriteDb(db: TestDb): ScopedDb {
  const forbidden = new Set(["insert", "update", "delete"]);

  const proxied = new Proxy(db as object, {
    get(target, property) {
      if (typeof property === "string" && forbidden.has(property)) {
        return () => {
          throw new Error(`readReplayScreen attempted a ${property} on the read path`);
        };
      }

      return bind(target, property);
    },
  });

  return proxied as ScopedDb;
}
