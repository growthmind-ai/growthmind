// THE CLIENT'S SIDE OF THE EIGHT ROUTES (O-008, AD-16, D9).
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
// # eight schemas is a `z.strictObject` that REFUSES an unrecognised key by
// # name, so a `projectId` posted from here would come back a 400 rather than
// # being silently stripped. The project comes from the session.
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
  analyticsConnect: "/api/first-run/analytics/connect",
  analyticsDisconnect: "/api/first-run/analytics/disconnect",
  slackConnect: "/api/first-run/slack/connect",
  slackTest: "/api/first-run/slack/test",
  slackSkip: "/api/first-run/slack/skip",
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
