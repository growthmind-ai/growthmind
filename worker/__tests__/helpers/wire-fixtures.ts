// Worker-lane test fixtures (O-003 Wave 0b, lane L5).
//
// Deliberately worker-local rather than an import of
// packages/db/__tests__/helpers/fixtures.ts: the five Wave 0b lanes are
// file-disjoint, and a lane that reaches into another lane's helper file
// re-couples them. Everything here seeds through `@growthmind/db`'s exported
// schema barrel against a real `createTestDb()` PGlite instance — no mocks,
// because the point of the wire proof is real SQL.
//
// FIXTURE SEED PREFIXES: `wk-` for the handler suite, `e2e-` for the wire
// proof. Every organization name, user email, and project name carries one.
// The previous sprint lost four tests to `user_email_unique` collisions from
// reused fixture emails — a red state that looked correct and was not — so
// every email here is prefix + a uuid, unique by construction.
//
// THE REPOSITORY IS PUBLIC. Every host, key, project id, and email below is an
// obviously-fake placeholder on a reserved-for-testing domain. Nothing here is
// or resembles real credential material.
import { randomUUID } from "node:crypto";

import type { FetchLike } from "@growthmind/adapters";
import { schema } from "@growthmind/db";
import type { ScopedDb } from "@growthmind/db";
import {
  credentialAad,
  encryptSecret,
  keyIdOf,
  parseServerEnv,
  resolveCredentialKey,
  tenantContextSchema,
} from "@growthmind/shared";
import type { ServerEnv, TenantContext } from "@growthmind/shared";

import type {
  AnalysisTrigger,
  PollLogger,
  SessionSourcePollDeps,
} from "../../src/tasks/session-source-poll";

// ---------------------------------------------------------------------------
// Obviously-fake placeholders. `.invalid` and `.example` are reserved by RFC
// 2606/6761 and can never resolve, so a test that somehow escaped its fake
// fetch would fail loudly rather than reach anything real.
// ---------------------------------------------------------------------------

/** Base64 of the 32 literal bytes `growthmind-worker-test-only-key!`. A
 * structurally valid AES-256 key that is published here and therefore
 * worthless as a secret — exactly like the repo's own dev default, but
 * distinct from it so a test can never be confused for a deployment. */
export const TEST_ENCRYPTION_KEY = "Z3Jvd3RobWluZC13b3JrZXItdGVzdC1vbmx5LWtleSE=";

export const FAKE_HOST = "https://posthog.invalid";

/** Shaped like a PostHog personal API key so `scrubSecrets` has something
 * realistic to redact, but composed entirely of the word "fake". */
export const FAKE_PERSONAL_API_KEY = "phx_fakefakefakefakefakefake0000";

/**
 * A `ServerEnv` with `NODE_ENV=test`, so `resolveCredentialKey` takes the
 * non-production branch and the published test key above is accepted. The
 * production refusal (D-1) is lane L1's test, not this lane's.
 */
export function testServerEnv(): ServerEnv {
  return parseServerEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://fake:fake@localhost:5432/fake",
    BETTER_AUTH_SECRET: "wk-test-only-secret-not-a-real-one",
    GROWTHMIND_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  });
}

/**
 * Produces the stored credential envelope the handler must be able to read
 * back. This deliberately goes through the REAL `encryptSecret`, against the
 * REAL key `resolveCredentialKey` derives from the environment the handler is
 * given — a hand-written ciphertext would only ever exercise the F-11
 * fail-closed branch and would prove nothing about the happy path.
 */
export function encryptTestCredential(params: {
  env: ServerEnv;
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

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

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
  /** `wk-` or `e2e-`. Carried by the org name, the owner email, and the
   * project name so no two lanes can collide on a unique index. */
  prefix: string;
  /**
   * The suite's own fake clock instant — REQUIRED, never defaulted to the
   * wall clock. `nextPollAt`/`connectedAt` below are anchored to this value,
   * not to `Date.now()`. A fake-clock suite drives `runSessionSourcePoll`
   * against `claimDuePollableConnections`'s `WHERE next_poll_at <= now`,
   * where `now` is the suite's `FakeClock`, not the real wall clock — a
   * scheduling column seeded from `Date.now()` is only "due" while the real
   * clock happens to sit after the fixture's fake `now`, which made this
   * whole lane time-of-day flaky (it failed only after 18:00 UTC). Every
   * caller must pass the SAME instant it hands to `createFakeClock`.
   */
  now: Date;
  host?: string;
  sourceProjectId?: string;
  isActive?: boolean;
  watermarkAt?: Date | null;
  backfillBefore?: string | null;
  /** Default is one hour before `now`, so the connection is DUE. */
  nextPollAt?: Date;
  pollIntervalSeconds?: number;
  connectedAt?: Date;
  inferredInternalDomain?: string | null;
  /**
   * Called once the org and project ids exist, because the ciphertext is bound
   * to `${organizationId}:${projectId}` as additional authenticated data and
   * cannot be produced before them. Omit to store an unreadable placeholder —
   * only tests that never reach a successful decrypt should do that.
   */
  credentialFor?: (ids: { organizationId: string; projectId: string }) => {
    ciphertext: string;
    keyId: string;
  };
}

/** An org with one owner, one project, and one connection on it. */
export async function seedPollableWorkspace(
  db: ScopedDb,
  params: SeedWorkspaceParams,
): Promise<SeededWorkspace> {
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const organizationName = `${params.prefix}org-${suffix}`;

  await db.insert(schema.organization).values({
    id: organizationId,
    name: organizationName,
    slug: `${params.prefix}slug-${suffix}`,
    createdAt: new Date(),
  });

  const ownerUserId = randomUUID();
  await db.insert(schema.user).values({
    id: ownerUserId,
    name: `${params.prefix}owner-${suffix}`,
    email: `${params.prefix}owner-${suffix}@fixtures.invalid`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(schema.member).values({
    id: randomUUID(),
    organizationId,
    userId: ownerUserId,
    role: "owner",
    createdAt: new Date(),
  });

  const connection = await seedProjectWithConnection(db, { ...params, organizationId });

  return {
    ...connection,
    organizationId,
    organizationName,
    ownerUserId,
    ownerCtx: tenantContextSchema.parse({
      userId: ownerUserId,
      organizationId,
      organizationName,
      role: "owner",
    }),
  };
}

/**
 * A second project and connection inside an EXISTING org. The partial unique
 * index is per project, so two active connections in one org are legitimate —
 * which is exactly the fixture the failure-isolation test needs (D8: one bad
 * connection must not fail its sibling).
 */
export async function seedProjectWithConnection(
  db: ScopedDb,
  params: SeedWorkspaceParams & { organizationId: string },
): Promise<SeededConnection> {
  const suffix = randomUUID();
  const projectId = randomUUID();

  await db.insert(schema.projects).values({
    id: projectId,
    organizationId: params.organizationId,
    name: `${params.prefix}project-${suffix}`,
  });

  const host = params.host ?? FAKE_HOST;
  const sourceProjectId = params.sourceProjectId ?? `${params.prefix}src-${suffix}`;
  const connectionId = randomUUID();
  const credential = params.credentialFor?.({
    organizationId: params.organizationId,
    projectId,
  });

  await db.insert(schema.projectConnections).values({
    id: connectionId,
    organizationId: params.organizationId,
    projectId,
    sourceKind: "posthog",
    host,
    sourceProjectId,
    credentialCiphertext: credential?.ciphertext ?? "v1.00000000.aaaa.bbbb.cccc",
    credentialKeyId: credential?.keyId ?? "00000000",
    isActive: params.isActive ?? true,
    health: "healthy",
    watermarkAt: params.watermarkAt ?? null,
    backfillBefore: params.backfillBefore ?? null,
    // Anchored to the suite's fake clock (`params.now`), never `Date.now()` —
    // see the invariant documented on `SeedWorkspaceParams.now`.
    nextPollAt: params.nextPollAt ?? new Date(params.now.getTime() - 60 * 60_000),
    pollIntervalSeconds: params.pollIntervalSeconds ?? 60,
    connectedAt: params.connectedAt ?? new Date(params.now.getTime() - 60 * 60_000),
    inferredInternalDomain: params.inferredInternalDomain ?? null,
  });

  return { projectId, connectionId, sourceProjectId, host };
}

/**
 * A second, NON-OWNER member of an existing org. Item 120's whole point (D1 /
 * P-4) is that this context reads the same numbers the connecting owner sees,
 * so the teammate must be a real `member` row, not a relabelled owner.
 */
export async function seedTeammateContext(
  db: ScopedDb,
  params: { prefix: string; organizationId: string; organizationName: string },
): Promise<TenantContext> {
  const suffix = randomUUID();
  const userId = randomUUID();

  await db.insert(schema.user).values({
    id: userId,
    name: `${params.prefix}mate-${suffix}`,
    email: `${params.prefix}mate-${suffix}@fixtures.invalid`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(schema.member).values({
    id: randomUUID(),
    organizationId: params.organizationId,
    userId,
    role: "member",
    createdAt: new Date(),
  });

  return tenantContextSchema.parse({
    userId,
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    role: "member",
  });
}

// ---------------------------------------------------------------------------
// The faked PostHog HTTP layer
// ---------------------------------------------------------------------------

/**
 * One upstream event, in the exact top-level shape the probe pinned
 * (addendum-a-pinned.md ROW 3/4/6): `person` is null on every item, and
 * `timestamp` is the client-declared event time in microsecond `+00:00` form,
 * never a `Z` suffix.
 */
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

/** The wire form of an instant: `YYYY-MM-DDTHH:mm:ss.ffffff+00:00`. Written
 * out here rather than imported so this fixture pins the SHAPE the probe
 * observed, independently of whatever `formatPostHogInstant` ends up doing. */
export function toPostHogInstant(d: Date): string {
  return `${d.toISOString().replace("Z", "")}000+00:00`;
}

export interface FakeEventsPage {
  results: unknown[];
  /** Literal `null` on the final page — never absent, never `""` (ROW 1). */
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
  /** 0-based, across the whole run — so a fault can fire on page 2 only. */
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
  /** Only the `/events` calls, in order. */
  eventsCalls(): FakeCall[];
  personsCalls(): FakeCall[];
}

/** The 401 envelope, verbatim in SHAPE (SEC-D): always 401, never 403, and
 * branching is on `code`, never on the status alone. */
export const FAKE_AUTH_FAILURE_BODY = {
  type: "authentication_error",
  code: "authentication_failed",
  detail: "Personal API key found in request Authorization header is invalid.",
  attr: null,
};

/** The 429 envelope — the same typed envelope as auth errors (ROW 5). */
export const FAKE_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled.",
  attr: null,
};

/**
 * A faked PostHog. NO REAL NETWORK CALL IS EVER MADE by any test in this lane:
 * this is the only `fetch` the handler is given, and it never touches a socket.
 */
export function createFakePostHog(options: {
  events?: (request: FakeEventsRequest) => FakeEventsPage | FakeFault;
  /** `distinct_id` → email, or `null` for "a completed lookup found no email". */
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

/** Builds the absolute `next` URL the server would emit — carrying every
 * original parameter forward plus an exclusive `before` (ROW 1). Tests build
 * it here so the adapter can only follow it VERBATIM. */
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

// ---------------------------------------------------------------------------
// The injected clock and the deps builder
// ---------------------------------------------------------------------------

export interface FakeClock {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Every `sleep` duration requested, in order. Asserting on this is how a
   * backoff sequence is proven with ZERO wall-clock waiting. */
  readonly sleeps: number[];
  advance: (ms: number) => void;
  set: (at: Date) => void;
}

/**
 * `sleep` advances the clock and resolves immediately — nothing in this lane
 * ever waits on real time. `now` is a plain reader, so a test can also step
 * the clock forward between handler invocations.
 */
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
  readonly errors: string[];
}

export function createRecordingLogger(): RecordingLogger {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message: string) => {
      infos.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}

/**
 * The deps the queue closure in ../../src/index.ts assembles, with every
 * effect faked: no network, no wall clock, no randomness. `random` returns a
 * fixed value so both jitter branches are exactly reproducible.
 */
export function createPollDeps(params: {
  db: ScopedDb;
  fetch: FetchLike;
  clock: FakeClock;
  env?: ServerEnv;
  random?: () => number;
  logger?: PollLogger;
  /** O-008 AD-11a. Defaults to a no-op recorder-free port, because every suite
   *  predating the onboarding trigger asserts on POLL behaviour and must be
   *  unaffected by it. A suite that cares about the ask supplies its own — see
   *  `onboarding-trigger-wire.test.ts`, which overrides this by spread. */
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
    // NOT OPTIONAL ON THE DEPS ITSELF, deliberately. An optional port is a wire
    // a composition root can leave unconnected in silence, which is precisely
    // the D11 failure this sprint inherits from the delivery composition. The
    // default lives HERE, in the fixture, where "this suite is not about the
    // trigger" is a statement a reader can check.
    requestAnalysis: params.requestAnalysis ?? { requestForProject: () => Promise.resolve() },
  };
}

// ---------------------------------------------------------------------------
// Plain-English assertions (P-2 bar), used by the terminal-state tests
// ---------------------------------------------------------------------------

/** D-13's forbidden vocabulary. A customer-facing failure reason may contain
 * none of these, and no bare 3-digit HTTP status. */
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
