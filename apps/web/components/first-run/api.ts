// No body below carries a tenancy key: the project comes from the session.
// `apps/web` declares no `zod`, so the narrowing here is hand-written.

import {
  NETWORK_FAILURE_NOTICE,
  type AgentConnection,
  type AgentProviderId,
  type InterestProviderId,
} from "@growthmind/shared";

export const FIRST_RUN_API = {
  status: "/api/first-run/status",
  arm: "/api/first-run/arm",
  dismiss: "/api/first-run/dismiss",
  interest: "/api/first-run/interest",
  agentKey: "/api/first-run/agent/key",
  agentRevoke: "/api/first-run/agent/revoke",
  analyticsDiscover: "/api/first-run/analytics/discover",
  analyticsConnect: "/api/first-run/analytics/connect",
  analyticsDisconnect: "/api/first-run/analytics/disconnect",
  slackConnect: "/api/first-run/slack/connect",
  slackTest: "/api/first-run/slack/test",
  slackSkip: "/api/first-run/slack/skip",
  // A browser navigation, never a `fetch`: it answers a 302 into Slack.
  slackOAuthStart: "/api/first-run/slack/oauth/start",
  slackChannels: "/api/first-run/slack/channels",
  slackChannel: "/api/first-run/slack/channel",
} as const;

// Read by every surface that shows the connection after setup, where first-run's own
// status route is neither reachable nor the right shape.
export const AGENT_API = {
  connection: "/api/agent/connection",
} as const;

// Separate write: this one MOVES a chosen address and stamps the delivery cutover.
export const SETTINGS_API = {
  slackChannel: "/api/settings/slack/channel",
  pageRole: "/api/settings/pages/role",
  site: "/api/settings/site",
  businessFact: "/api/settings/business/fact",
} as const;

export interface PostAnswer {
  readonly ok: boolean;
  readonly body: unknown;
}

export interface ResponseRefusal {
  readonly code: string | null;

  readonly message: string;
}

export interface DiscoveredProjectView {
  readonly sourceProjectId: string;

  readonly name: string;
}

// One object: the host the walk settled on can never be paired with another
// walk's projects.
export interface DiscoveryAnswer {
  readonly host: string;
  readonly projects: readonly DiscoveredProjectView[];
}

export interface SlackChannelChoice {
  readonly id: string;
  readonly name: string;
}

// `moved: false` is a 200: re-picking the channel already set is not a refusal.
export interface ChannelMoveAnswer {
  readonly moved: boolean;
  readonly sentence: string;
}

// A 200 even when the post itself failed (D8).
export interface TestPostAnswer {
  readonly ok: boolean;
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export async function postJson(path: string, body: unknown): Promise<PostAnswer | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return { ok: response.ok, body: (await response.json()) as unknown };
  } catch {
    return null;
  }
}

export async function getJson(path: string): Promise<PostAnswer | null> {
  try {
    const response = await fetch(path);
    return { ok: response.ok, body: (await response.json()) as unknown };
  } catch {
    return null;
  }
}

// Both refusal shapes. `message` is what a person reads; `code` is there so a
// caller can branch — move focus to the field the sentence is about.
export function readRefusal(body: unknown): ResponseRefusal | null {
  const record = asRecord(body);
  if (record === null) return null;

  const nested = asRecord(record.refusal) ?? asRecord(record.error);
  if (nested === null) return null;

  const message = nested.message;
  if (typeof message !== "string") return null;

  return { code: typeof nested.code === "string" ? nested.code : null, message };
}

export type ActionOutcome =
  { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly message: string };

// The three-way discrimination every card's simple POST repeats: a dead transport
// and a refusal both read as one sentence, because a person cannot act on which
// it was. `fallback` is the sentence for a refusal that carries none.
export async function postForOutcome(
  path: string,
  body: unknown,
  fallback: string,
): Promise<ActionOutcome> {
  const answer = await postJson(path, body);

  if (answer === null || !answer.ok) {
    return { ok: false, message: readRefusal(answer?.body)?.message ?? fallback };
  }

  return { ok: true, body: answer.body };
}

// Any `ok: true` means noted — the body is `{ noted: true }` on first and
// repeat taps alike, so there is nothing else to read from it (AD-6).
export async function postInterest(provider: InterestProviderId): Promise<ActionOutcome> {
  return postForOutcome(FIRST_RUN_API.interest, { provider }, NETWORK_FAILURE_NOTICE);
}

// The raw key is in this one response and nowhere else; `null` is every failure.
export async function mintAgentKey(provider: AgentProviderId): Promise<string | null> {
  const answer = await postJson(FIRST_RUN_API.agentKey, { provider });

  if (answer === null || !answer.ok) {
    return null;
  }

  const key = asRecord(answer.body)?.key;

  return typeof key === "string" && key !== "" ? key : null;
}

// `null` for every failure, including a refusal: a caller holding a connection keeps the
// one it has rather than replacing it with a worse guess.
export async function readAgentConnection(): Promise<AgentConnection | null> {
  const answer = await getJson(AGENT_API.connection);

  if (answer === null || !answer.ok) {
    return null;
  }

  const kind = asRecord(asRecord(answer.body)?.connection)?.kind;

  return kind === "none" || kind === "waiting" || kind === "connected" ? { kind } : null;
}

// No id: the route revokes every live key in the caller's organisation.
export async function revokeAgentKeys(): Promise<boolean> {
  const answer = await postJson(FIRST_RUN_API.agentRevoke, {});

  return answer !== null && answer.ok;
}

// A nameless row is a choice nobody can make, so an entry missing either field
// is dropped and an emptied list answers `null`. Discovery's order is preserved.
export function readDiscovery(body: unknown): DiscoveryAnswer | null {
  const record = asRecord(body);
  if (record === null) return null;

  const { host, projects } = record;
  if (typeof host !== "string" || host === "" || !Array.isArray(projects)) return null;

  const found: DiscoveredProjectView[] = [];
  for (const entry of projects) {
    const project = asRecord(entry);
    const sourceProjectId = project?.sourceProjectId;
    const name = project?.name;
    if (typeof sourceProjectId !== "string" || typeof name !== "string") continue;
    if (sourceProjectId === "" || name === "") continue;
    found.push({ sourceProjectId, name });
  }

  return found.length === 0 ? null : { host, projects: found };
}

// `null` for anything that is not a successful listing; an empty ARRAY is a
// real answer meaning Slack showed us nothing.
export function readChannelList(body: unknown): readonly SlackChannelChoice[] | null {
  const record = asRecord(body);
  if (record === null || record.ok !== true || !Array.isArray(record.channels)) return null;

  const found: SlackChannelChoice[] = [];
  for (const entry of record.channels) {
    const channel = asRecord(entry);
    const id = channel?.id;
    const name = channel?.name;
    if (typeof id !== "string" || typeof name !== "string") continue;
    if (id === "" || name === "") continue;
    found.push({ id, name });
  }

  return found;
}

// `retryable` decides whether a retry is offered: two of the four failures can
// never succeed on a second press.
export function readChannelMoveAnswer(body: unknown): ChannelMoveAnswer | null {
  const record = asRecord(body);
  if (record === null) return null;

  const sentence = record.sentence;
  if (typeof sentence !== "string") return null;

  return { moved: record.moved === true, sentence };
}

export function readTestPostAnswer(body: unknown): TestPostAnswer | null {
  const record = asRecord(body);
  if (record === null) return null;

  const sentence = record.sentence;
  if (typeof sentence !== "string") return null;

  return {
    ok: record.ok === true,
    sentence,
    retryable: record.retryable === true,
    marksStepDone: record.marksStepDone === true,
  };
}
