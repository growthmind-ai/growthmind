// Test doubles for the SessionSource port, used by the `packages/db` service
// suites (O-003 Wave 0b, lane 4).
//
// WHY A FAKE AND NOT A NETWORK CALL. `createConnectionsService` takes
// `createSource` as an INJECTED dependency precisely so `packages/db` never
// depends on `packages/adapters` (D-11's layering rule). This file is the
// other half of that decision: every connection-service test below runs
// against a real database and a fake source, with no fetch, no host, and no
// credential that could ever authenticate anywhere.
//
// Nothing here is a mock in the assert-on-calls-only sense — it is a real
// implementation of `AttachableSource` with test-visible state, so the tests
// assert on OUTCOMES (what was persisted, what the service returned) and use
// the recorded calls only to prove bounds (exactly one pull, one page).
import type {
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
  SourceEvent,
  SourceFailure,
  SourceSession,
} from "@growthmind/shared";

import type {
  AttachableSource,
  CreateSourceFn,
  SourceConnectionConfig,
} from "../../src/services/connections.service";

/**
 * An obviously-fake personal key. THIS REPOSITORY IS PUBLIC: this value is not
 * a credential, cannot authenticate anywhere, and exists only so the
 * no-key-material assertions have something concrete to look for. It carries
 * the `ph<letter>_` prefix on purpose, so a pattern-based scrubber has a real
 * target, and it contains `+` and `/` so its URL-encoded form differs from its
 * raw form — an exact-whole-string scrub would miss the encoded one.
 */
export const FAKE_PERSONAL_KEY = "phx_FAKE+not/a/real/key/0123456789_placeholder";

/** The same fake key in every shape a leaky boundary could echo it back in. */
export const FAKE_PERSONAL_KEY_FORMS: readonly string[] = [
  FAKE_PERSONAL_KEY,
  encodeURIComponent(FAKE_PERSONAL_KEY),
  JSON.stringify(FAKE_PERSONAL_KEY).slice(1, -1),
  FAKE_PERSONAL_KEY.slice(0, 24),
];

/** Any `ph<letter>_…` shaped token, however it was re-encoded around the edges. */
export const KEY_MATERIAL_PATTERN = /\bph[a-z]_[A-Za-z0-9_+/%-]{16,}/i;

export const FAKE_HOST = "https://eu.analytics.example.invalid";
export const FAKE_SOURCE_PROJECT_ID = "00000";

export function okValidation(checkedAt: Date): SessionSourceValidation {
  return { ok: true, checkedAt };
}

export function failedValidation(checkedAt: Date, failure: SourceFailure): SessionSourceValidation {
  return { ok: false, checkedAt, failure };
}

export function emptyPull(): SessionSourcePullResult {
  return {
    ok: true,
    sessions: [],
    events: [],
    newestObservedAt: null,
    contiguous: true,
    resumeBefore: null,
    pagesFetched: 1,
    droppedMalformed: 0,
    identityLookupsUsed: 0,
    eventsReceived: 0,
  };
}

export function successfulPull(input: {
  sessions: readonly SourceSession[];
  events: readonly SourceEvent[];
  newestObservedAt?: Date | null;
  droppedMalformed?: number;
}): SessionSourcePullResult {
  return {
    ok: true,
    sessions: [...input.sessions],
    events: [...input.events],
    newestObservedAt:
      input.newestObservedAt ??
      (input.events.length > 0
        ? new Date(Math.max(...input.events.map((e) => e.occurredAt.getTime())))
        : null),
    contiguous: true,
    resumeBefore: null,
    pagesFetched: 1,
    droppedMalformed: input.droppedMalformed ?? 0,
    identityLookupsUsed: 0,
    eventsReceived: input.events.length,
  };
}

export function failedPull(input: {
  failure: SourceFailure;
  partialSessions?: readonly SourceSession[];
  partialEvents?: readonly SourceEvent[];
  droppedMalformed?: number;
}): SessionSourcePullResult {
  const partialEvents = input.partialEvents ?? [];
  return {
    ok: false,
    failure: input.failure,
    partialSessions: [...(input.partialSessions ?? [])],
    partialEvents: [...partialEvents],
    pagesFetched: 1,
    droppedMalformed: input.droppedMalformed ?? 0,
    identityLookupsUsed: 0,
    eventsReceived: partialEvents.length,
  };
}

/**
 * Builds one assembled session as it crosses the port. Defaults describe an
 * ordinary kept session: an outside email domain, a resolved identity, and an
 * everyday headed browser. Each test overrides only the fact it is about.
 */
export function sourceSession(input: {
  sessionKey: string;
  identityKey?: string | null;
  identityEmailDomain?: string | null;
  identityResolution?: SourceSession["identityResolution"];
  userAgent?: string | null;
  entryUrlPath?: string | null;
  startedAt?: Date;
  lastEventAt?: Date;
}): SourceSession {
  const startedAt = input.startedAt ?? new Date("2026-07-30T11:00:00.000Z");
  return {
    sessionKey: input.sessionKey,
    identityKey: input.identityKey ?? `distinct-${input.sessionKey}`,
    identityEmailDomain:
      input.identityEmailDomain === undefined ? "outside-example.test" : input.identityEmailDomain,
    identityResolution: input.identityResolution ?? "resolved",
    userAgent:
      input.userAgent === undefined
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        : input.userAgent,
    entryUrlPath: input.entryUrlPath === undefined ? "/pricing" : input.entryUrlPath,
    startedAt,
    lastEventAt: input.lastEventAt ?? startedAt,
  };
}

export function sourceEvent(input: {
  sourceEventId: string;
  sessionKey: string;
  name?: string;
  occurredAt?: Date;
  urlPath?: string | null;
}): SourceEvent {
  return {
    sourceEventId: input.sourceEventId,
    sessionKey: input.sessionKey,
    name: input.name ?? "$pageview",
    occurredAt: input.occurredAt ?? new Date("2026-07-30T11:00:00.000Z"),
    urlPath: input.urlPath === undefined ? "/pricing" : input.urlPath,
  };
}

export interface FakeSourceHarness {
  /** Injected as `deps.createSource`. */
  createSource: CreateSourceFn;
  /** Every config the service handed the factory, in call order. */
  readonly configs: SourceConnectionConfig[];
  /** Every `pull` request, in call order — the bound proof for D-7's ONE
   * inline first pull of ONE page. */
  readonly pullRequests: SessionSourcePullRequest[];
  /** How many times `validate()` was called. */
  readonly validateCalls: { count: number };
}

/**
 * Builds a fake source factory. `pulls` is consumed in order; once exhausted,
 * the last entry repeats, so a test that only cares about the first pull does
 * not have to script every subsequent one.
 */
export function makeFakeSource(script?: {
  validation?:
    SessionSourceValidation | ((config: SourceConnectionConfig) => SessionSourceValidation);
  pulls?: readonly SessionSourcePullResult[];
}): FakeSourceHarness {
  const configs: SourceConnectionConfig[] = [];
  const pullRequests: SessionSourcePullRequest[] = [];
  const validateCalls = { count: 0 };
  const pulls = script?.pulls ?? [emptyPull()];

  const createSource: CreateSourceFn = (config) => {
    configs.push(config);

    const source: AttachableSource = {
      validate(): Promise<SessionSourceValidation> {
        validateCalls.count += 1;
        const validation = script?.validation ?? okValidation(new Date("2026-07-30T12:00:00.000Z"));
        return Promise.resolve(typeof validation === "function" ? validation(config) : validation);
      },
      pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult> {
        pullRequests.push(request);
        const index = Math.min(pullRequests.length - 1, pulls.length - 1);
        const result = pulls[index];
        if (!result) {
          throw new Error("makeFakeSource: no pull result scripted");
        }
        return Promise.resolve(result);
      },
    };

    return source;
  };

  return { createSource, configs, pullRequests, validateCalls };
}
