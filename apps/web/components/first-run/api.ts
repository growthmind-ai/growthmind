// THE CLIENT'S SIDE OF THE SURFACE'S ROUTES (O-008, AD-16, D9).
//
// ###########################################################################
// # ONE HOME FOR THE PATHS, FOR THE REASON `lib/routes.ts` ALREADY GIVES.
// #
// # A retyped path is a silent 404 that typechecks perfectly. `ROUTES` covers
// # the app's PAGES; these are the surface's own verbs, and they get the same
// # treatment — every caller imports the constant, so a typo is a compile
// # error rather than a submit button that answers nothing.
// #
// # NO BODY BELOW CARRIES A TENANCY KEY, and none ever may. Every one of the
// # schemas is a `z.strictObject` that REFUSES an unrecognised key by name, so
// # a `projectId` posted from here would come back a 400 rather than being
// # silently stripped. The project comes from the session. (The count of routes
// # is deliberately not written down here — it moved twice in one sprint, and a
// # number in a comment is a number nothing checks.)
// ###########################################################################
//
// ── WHY THE NARROWING BELOW IS HAND-WRITTEN ─────────────────────────────────
//
// `apps/web` declares no `zod` dependency and a pinned test keeps it that way,
// so a response body is narrowed here by hand. It is deliberately small: it
// reads the two shapes the routes actually answer with and returns `null` for
// anything else, which the caller renders as the shipped network-failure
// sentence rather than as a blank.
//
// THIS FILE AUTHORS NO CUSTOMER-FACING STRING. Every sentence it surfaces was
// composed by a route from the shipped tables and is passed through verbatim.

/** The surface's own verbs. Never retyped at a call site. */
export const FIRST_RUN_API = {
  status: "/api/first-run/status",
  arm: "/api/first-run/arm",
  dismiss: "/api/first-run/dismiss",
  analyticsDiscover: "/api/first-run/analytics/discover",
  analyticsConnect: "/api/first-run/analytics/connect",
  analyticsDisconnect: "/api/first-run/analytics/disconnect",
  slackConnect: "/api/first-run/slack/connect",
  slackTest: "/api/first-run/slack/test",
  slackSkip: "/api/first-run/slack/skip",
  // AD-5's door out. Reached by a plain browser navigation, never by `fetch` —
  // it answers a 302 into Slack's own consent screen and sets the other half of
  // the signed state on the way, and neither of those survives being read as
  // JSON by a script.
  slackOAuthStart: "/api/first-run/slack/oauth/start",
  slackChannels: "/api/first-run/slack/channels",
  slackChannel: "/api/first-run/slack/channel",
} as const;

/** A response that arrived, whatever it said. `null` means it never did. */
export interface PostAnswer {
  readonly ok: boolean;
  readonly body: unknown;
}

/** A refusal a step can render, in the caller's own words. */
export interface ResponseRefusal {
  /** The machine code, for choosing which field to focus. NEVER rendered. */
  readonly code: string | null;
  /** The shipped sentence. Rendered verbatim. */
  readonly message: string;
}

/** One project the pasted key can read, as the discovery door reports it. */
export interface DiscoveredProjectView {
  /** The vendor's own id, opaque text. Sent straight back on connect. */
  readonly sourceProjectId: string;
  /** The project's name as the founder's own account spells it. */
  readonly name: string;
}

/**
 * What the key bought: the address it answered on, and the projects it can see.
 *
 * ONE OBJECT, AND THAT IS THE POINT (D11). The host is what the walk settled
 * on and the connect call that follows must send THAT host with THOSE projects
 * — a founder whose key answered on the EU address must not have a US address
 * stored beside an EU project id. Carrying them as one value means there is no
 * moment where a component holds one and not the other.
 */
export interface DiscoveryAnswer {
  readonly host: string;
  readonly projects: readonly DiscoveredProjectView[];
}

/**
 * One channel the attached workspace can be posted in (AD-7).
 *
 * `{ id, name }` and nothing else, because that is all the listing route
 * answers with — no token, no team id, no vendor flags. The id is opaque text
 * that goes straight back on the pick; nothing here parses it.
 */
export interface SlackChannelChoice {
  readonly id: string;
  readonly name: string;
}

/** The Slack test post's answer — a 200 even when the post failed (D8). */
export interface TestPostAnswer {
  readonly ok: boolean;
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * POST a JSON body and come back with something renderable, never a throw.
 *
 * A network failure and a malformed answer both resolve to `null`. The caller
 * turns that into the one shipped sentence for "it never reached us", which is
 * true of both and is the only honest thing either case can say.
 */
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

/**
 * The same, for the one route a step READS from rather than posts to.
 *
 * The channel list is fetched live at pick time and stored nowhere (AD-7), so
 * it is a GET — and it takes the same never-throw shape as `postJson` for the
 * same reason: a dropped connection and a body we cannot read are one fact to
 * the person waiting, and both belong on the shipped network-failure sentence.
 */
export async function getJson(path: string): Promise<PostAnswer | null> {
  try {
    const response = await fetch(path);
    return { ok: response.ok, body: (await response.json()) as unknown };
  } catch {
    return null;
  }
}

/**
 * The refusal on a body, in either of the two shapes the routes use.
 *
 * The connect verbs answer `{ ok: false, refusal }`; the shared gate answers
 * `{ error }`. Both carry a plain-English `message` from a shipped table and a
 * machine `code` that exists so a step can move focus to the field the
 * sentence is about — the code itself never reaches a screen.
 */
export function readRefusal(body: unknown): ResponseRefusal | null {
  const record = asRecord(body);
  if (record === null) return null;

  const nested = asRecord(record.refusal) ?? asRecord(record.error);
  if (nested === null) return null;

  const message = nested.message;
  if (typeof message !== "string") return null;

  return { code: typeof nested.code === "string" ? nested.code : null, message };
}

/**
 * The discovery door's success body, narrowed by hand.
 *
 * A malformed body answers `null`, which the caller renders as the shipped
 * network-failure sentence — the same fail direction `readRefusal` takes, and
 * the honest one: we cannot show a chooser built from something we could not
 * read. An entry missing either field is DROPPED rather than admitted with a
 * blank name, because a nameless row in a pick list is a choice nobody can
 * make; if that empties the list the caller refuses rather than rendering a
 * chooser with nothing in it.
 *
 * THE ORDER IS PRESERVED EXACTLY. Discovery sorts projects that have seen
 * events first, then by name, and re-sorting here would be a second opinion
 * about which project a founder most likely wants.
 */
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

/**
 * The picker's list, narrowed by hand.
 *
 * `null` for a body that is not a successful listing — a refusal, or something
 * we could not read — so the caller renders the route's own sentence rather
 * than an empty picker. AN EMPTY PICKER IS A LIE: it reads as "your workspace
 * has no channels", which sends a founder off to create one they already have.
 *
 * A row missing either field is DROPPED rather than admitted with a blank name,
 * for the reason `readDiscovery` gives one type up: a nameless row in a list is
 * a choice nobody can make. The order is preserved exactly as Slack returned
 * it; re-sorting here would be a second opinion nothing licensed.
 */
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

/**
 * The Slack test post's outcome.
 *
 * `sentence` is already the shipped failure sentence plus the onboarding
 * clause, composed server-side, so this reads it and renders it. `retryable`
 * decides whether a retry is even offered: two of the four failures can never
 * succeed on a second press, and a button that cannot work is worse than none.
 */
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
