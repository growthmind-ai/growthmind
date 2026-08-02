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

export const FAKE_PERSONAL_KEY = "phx_FAKE+not/a/real/key/0123456789_placeholder";

export const FAKE_PERSONAL_KEY_FORMS: readonly string[] = [
  FAKE_PERSONAL_KEY,
  encodeURIComponent(FAKE_PERSONAL_KEY),
  JSON.stringify(FAKE_PERSONAL_KEY).slice(1, -1),
  FAKE_PERSONAL_KEY.slice(0, 24),
];

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

export function pageCappedPull(input: {
  sessions: readonly SourceSession[];
  events: readonly SourceEvent[];
  resumeBefore: string;
}): SessionSourcePullResult {
  return {
    ok: true,
    sessions: [...input.sessions],
    events: [...input.events],
    newestObservedAt: null,
    contiguous: false,
    resumeBefore: input.resumeBefore,
    pagesFetched: 1,
    droppedMalformed: 0,
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
  createSource: CreateSourceFn;

  readonly configs: SourceConnectionConfig[];

  readonly pullRequests: SessionSourcePullRequest[];

  readonly validateCalls: { count: number };
}

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
