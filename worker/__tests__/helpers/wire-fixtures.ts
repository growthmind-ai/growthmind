import { randomUUID } from "node:crypto";

import type { FetchLike } from "@growthmind/adapters";
import type { ScopedDb } from "@growthmind/db";
import {
  makeTenantContext,
  seedConnection,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "@growthmind/db/testing";
import {
  credentialAad,
  encryptSecret,
  keyIdOf,
  parseWorkerEnv,
  resolveCredentialKey,
} from "@growthmind/shared";
import type { WorkerEnv, TenantContext } from "@growthmind/shared";

import type {
  AnalysisTrigger,
  PollLogger,
  SessionSourcePollDeps,
} from "../../src/tasks/session-source-poll";

export const TEST_ENCRYPTION_KEY = "Z3Jvd3RobWluZC13b3JrZXItdGVzdC1vbmx5LWtleSE=";

export const FAKE_HOST = "https://posthog.invalid";

export const FAKE_PERSONAL_API_KEY = "phx_fakefakefakefakefakefake0000";

export function testServerEnv(): WorkerEnv {
  return parseWorkerEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://fake:fake@localhost:5432/fake",
    BETTER_AUTH_SECRET: "wk-test-only-secret-not-a-real-one",
    GROWTHMIND_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  });
}

export function encryptTestCredential(params: {
  env: WorkerEnv;
  organizationId: string;
  projectId: string;
  personalApiKey?: string;
}): { ciphertext: string; keyId: string } {
  const resolution = resolveCredentialKey(params.env);
  if (!resolution.ok) {
    throw new Error(`test fixture: resolveCredentialKey refused (${resolution.reason})`);
  }
  const aad = credentialAad(params.organizationId, params.projectId);
  return {
    ciphertext: encryptSecret(params.personalApiKey ?? FAKE_PERSONAL_API_KEY, resolution.key, aad),
    keyId: keyIdOf(resolution.key),
  };
}

export interface SeededConnection {
  projectId: string;
  connectionId: string;
  sourceProjectId: string;
  host: string;
}

export interface SeededWorkspace extends SeededConnection {
  organizationId: string;
  organizationName: string;
  ownerUserId: string;
  ownerCtx: TenantContext;
}

export interface SeedWorkspaceParams {
  prefix: string;

  now: Date;
  host?: string;
  sourceProjectId?: string;
  isActive?: boolean;
  watermarkAt?: Date | null;
  backfillBefore?: string | null;

  nextPollAt?: Date;
  pollIntervalSeconds?: number;
  connectedAt?: Date;
  inferredInternalDomain?: string | null;

  credentialFor?: (ids: { organizationId: string; projectId: string }) => {
    ciphertext: string;
    keyId: string;
  };
}

export async function seedPollableWorkspace(
  db: ScopedDb,
  params: SeedWorkspaceParams,
): Promise<SeededWorkspace> {
  const suffix = randomUUID();
  const org = await seedOrgWithOwner(db, {
    orgName: `${params.prefix}org-${suffix}`,
    userName: `${params.prefix}owner-${suffix}`,
    email: `${params.prefix}owner-${suffix}@fixtures.invalid`,
  });

  const connection = await seedProjectWithConnection(db, {
    ...params,
    organizationId: org.organizationId,
  });

  return {
    ...connection,
    organizationId: org.organizationId,
    organizationName: org.organizationName,
    ownerUserId: org.userId,
    ownerCtx: org.ctx,
  };
}

export async function seedProjectWithConnection(
  db: ScopedDb,
  params: SeedWorkspaceParams & { organizationId: string },
): Promise<SeededConnection> {
  const suffix = randomUUID();
  const project = await seedProject(db, {
    organizationId: params.organizationId,
    name: `${params.prefix}project-${suffix}`,
  });

  const host = params.host ?? FAKE_HOST;
  const sourceProjectId = params.sourceProjectId ?? `${params.prefix}src-${suffix}`;
  const credential = params.credentialFor?.({
    organizationId: params.organizationId,
    projectId: project.id,
  });
  const anHourBefore = new Date(params.now.getTime() - 60 * 60_000);

  const connection = await seedConnection(db, {
    organizationId: params.organizationId,
    projectId: project.id,
    host,
    sourceProjectId,
    ...(credential
      ? { credentialCiphertext: credential.ciphertext, credentialKeyId: credential.keyId }
      : {}),
    isActive: params.isActive ?? true,
    watermarkAt: params.watermarkAt ?? null,
    backfillBefore: params.backfillBefore ?? null,
    nextPollAt: params.nextPollAt ?? anHourBefore,
    pollIntervalSeconds: params.pollIntervalSeconds ?? 60,
    connectedAt: params.connectedAt ?? anHourBefore,
    inferredInternalDomain: params.inferredInternalDomain ?? null,
  });

  return { projectId: project.id, connectionId: connection.id, sourceProjectId, host };
}

export async function seedTeammateContext(
  db: ScopedDb,
  params: { prefix: string; organizationId: string; organizationName: string },
): Promise<TenantContext> {
  const suffix = randomUUID();
  const user = await seedUser(db, {
    name: `${params.prefix}mate-${suffix}`,
    email: `${params.prefix}mate-${suffix}@fixtures.invalid`,
  });

  await seedMember(db, {
    organizationId: params.organizationId,
    userId: user.id,
    role: "member",
  });

  return makeTenantContext({
    userId: user.id,
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    role: "member",
  });
}

export function fakeEvent(params: {
  id?: string;
  distinctId: string | null;
  name?: string;
  occurredAt: Date;
  sessionId?: string | null;
  pathname?: string | null;
  userAgent?: string | null;
  setEmail?: string | null;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (params.sessionId != null) properties["$session_id"] = params.sessionId;
  if (params.pathname != null) properties["$pathname"] = params.pathname;
  if (params.userAgent != null) properties["$raw_user_agent"] = params.userAgent;
  if (params.setEmail != null) properties["$set"] = { email: params.setEmail };

  return {
    id: params.id ?? randomUUID(),
    distinct_id: params.distinctId,
    properties,
    event: params.name ?? "$pageview",
    timestamp: toPostHogInstant(params.occurredAt),
    person: null,
    elements: [],
    elements_chain: "",
  };
}

export function toPostHogInstant(d: Date): string {
  return `${d.toISOString().replace("Z", "")}000+00:00`;
}

export interface FakeEventsPage {
  results: unknown[];

  next: string | null;
}

export type FakeFault =
  | { readonly kind: "network"; readonly message: string }
  | {
      readonly kind: "status";
      readonly status: number;
      readonly body: unknown;
      readonly headers?: Record<string, string>;
    };

export interface FakeEventsRequest {
  readonly url: URL;
  readonly after: string | null;
  readonly before: string | null;

  readonly callIndex: number;
}

export interface FakeCall {
  readonly url: string;
  readonly endpoint: "events" | "persons";
  readonly authorization: string | null;
}

export interface FakePostHog {
  readonly fetch: FetchLike;
  readonly calls: FakeCall[];

  eventsCalls(): FakeCall[];
  personsCalls(): FakeCall[];
}

export const FAKE_AUTH_FAILURE_BODY = {
  type: "authentication_error",
  code: "authentication_failed",
  detail: "Personal API key found in request Authorization header is invalid.",
  attr: null,
};

export const FAKE_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled.",
  attr: null,
};

export function createFakePostHog(options: {
  events?: (request: FakeEventsRequest) => FakeEventsPage | FakeFault;

  persons?: (distinctId: string) => string | null;
}): FakePostHog {
  const calls: FakeCall[] = [];
  let eventsCallIndex = 0;

  const fetchImpl = (async (input: Parameters<FetchLike>[0], init?: RequestInit) => {
    const raw = urlOf(input);
    const url = new URL(raw);
    const endpoint: "events" | "persons" = url.pathname.includes("/persons") ? "persons" : "events";
    calls.push({ url: raw, endpoint, authorization: authorizationOf(input, init) });

    if (endpoint === "persons") {
      const distinctId = url.searchParams.get("distinct_id") ?? "";
      const email = options.persons?.(distinctId) ?? null;
      return jsonResponse(200, {
        results: email === null ? [] : [{ properties: { email } }],
      });
    }

    const outcome = options.events?.({
      url,
      after: url.searchParams.get("after"),
      before: url.searchParams.get("before"),
      callIndex: eventsCallIndex,
    }) ?? { results: [], next: null };
    eventsCallIndex += 1;

    if ("results" in outcome) {
      return jsonResponse(200, outcome);
    }
    if (outcome.kind === "network") {
      throw new TypeError(outcome.message);
    }
    return jsonResponse(outcome.status, outcome.body, outcome.headers);
  }) as FetchLike;

  return {
    fetch: fetchImpl,
    calls,
    eventsCalls: () => calls.filter((call) => call.endpoint === "events"),
    personsCalls: () => calls.filter((call) => call.endpoint === "persons"),
  };
}

export function nextCursorUrl(params: {
  host?: string;
  sourceProjectId: string;
  before: Date;
}): string {
  const url = new URL(`${params.host ?? FAKE_HOST}/api/projects/${params.sourceProjectId}/events`);
  url.searchParams.set("limit", "200");
  url.searchParams.set("before", toPostHogInstant(params.before));
  return url.toString();
}

function urlOf(input: Parameters<FetchLike>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function authorizationOf(input: Parameters<FetchLike>[0], init?: RequestInit): string | null {
  const fromInit = new Headers(init?.headers ?? {}).get("authorization");
  if (fromInit !== null) return fromInit;
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.headers.get("authorization");
  }
  return null;
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export interface FakeClock {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;

  readonly sleeps: number[];
  advance: (ms: number) => void;
  set: (at: Date) => void;
}

export function createFakeClock(start: Date): FakeClock {
  let current = start.getTime();
  const sleeps: number[] = [];

  return {
    now: () => new Date(current),
    sleep: (ms: number) => {
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    },
    sleeps,
    advance: (ms: number) => {
      current += ms;
    },
    set: (at: Date) => {
      current = at.getTime();
    },
  };
}

export interface RecordingLogger extends PollLogger {
  readonly infos: string[];
  readonly warns: string[];
  readonly errors: string[];
}

export function createRecordingLogger(): RecordingLogger {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    warns,
    errors,
    info: (message: string) => {
      infos.push(message);
    },
    warn: (message: string) => {
      warns.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}

export function createPollDeps(params: {
  db: ScopedDb;
  fetch: FetchLike;
  clock: FakeClock;
  env?: WorkerEnv;
  random?: () => number;
  logger?: PollLogger;

  requestAnalysis?: AnalysisTrigger;
}): SessionSourcePollDeps {
  return {
    db: params.db,
    env: params.env ?? testServerEnv(),
    now: params.clock.now,
    sleep: params.clock.sleep,
    fetch: params.fetch,
    random: params.random ?? (() => 0.5),
    logger: params.logger ?? createRecordingLogger(),

    requestAnalysis: params.requestAnalysis ?? { requestForProject: () => Promise.resolve() },
  };
}

export const FORBIDDEN_JARGON = [
  "tenant",
  "adapter",
  "watermark",
  "idempotent",
  "upsert",
  "jsonb",
  "endpoint",
  "null",
  "undefined",
] as const;

export function jargonIn(message: string): string[] {
  const lowered = message.toLowerCase();
  const hits: string[] = FORBIDDEN_JARGON.filter((token) =>
    new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(lowered),
  );
  if (/(^|[^0-9])[1-5][0-9]{2}([^0-9]|$)/.test(message)) hits.push("bare-http-status");
  return hits;
}
