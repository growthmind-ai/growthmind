// HOW THE CONSENT ROUND TRIP TELLS THE PAGE WHAT HAPPENED (AD-5, AD-6, AD-7).
//
// ###########################################################################
// # THE CALLBACK IS THE ONE ROUTE ON THIS SURFACE A BROWSER LANDS ON, SO IT
// # ANSWERS WITH A REDIRECT AND NOT WITH A BODY.
// #
// # Every other first-run route is called from script and answers JSON. This
// # one is reached by Slack sending the founder back, which means its answer
// # is a page — and a founder who sees `{"ok":false}` has been dropped outside
// # the product with no way back. So the outcome travels as a query value on
// # the onboarding surface, and the page turns it into a sentence.
// #
// # WHICH MAKES THIS A D11 WIRE WITH TWO ENDS, AND THIS FILE IS THE ONE HOME
// # FOR BOTH. The producer imports the parameter name and the vocabulary; the
// # consumer imports the reader. Neither spells the other's string, so a
// # rename is a compile error rather than a branch that silently never runs.
// ###########################################################################
//
// ── WHAT IS DELIBERATELY NOT HERE: THE SENTENCES ────────────────────────────
//
// The words a founder reads belong in
// `packages/shared/src/onboarding/messages.ts`, which is separately audited for
// durations, jargon and the two-name proper-noun allow-list, and registered in
// `ALL_ONBOARDING_MESSAGES` or it escapes that audit silently. The wave that
// renders the sentence owns writing it. What is here is the VOCABULARY — the
// set of things that can have happened — because that is the producer's own
// decision and it has to be stable before anybody can write copy against it.
//
// ── WHY THESE SIX AND NOT ONE `failed` ──────────────────────────────────────
//
// Each arm below has a DIFFERENT next action, and a founder given the wrong one
// does work that cannot help. "Start again" is right for a stale round trip and
// useless for an installation with no Slack app configured; "someone has to
// disconnect the other channel" is right for a second workspace and nonsense
// for a transport failure. Collapsing them would be collapsing five different
// instructions into one shrug.
import { ROUTES } from "@/lib/routes";

/**
 * The query parameter the callback puts its outcome on.
 *
 * Short and lowercase because it is visible in a founder's address bar. It is
 * `slack` rather than something like `slack_oauth_result` for the same reason
 * the onboarding copy carries no machine identifiers: the address bar is a
 * surface too.
 */
export const SLACK_OAUTH_OUTCOME_PARAM = "slack";

/**
 * What the round trip settled on. One value per next action.
 *
 * - `connected` — the workspace is attached. Nothing can be delivered yet: the
 *   channel is the next screen, which is why this is not "done".
 * - `declined` — the founder said no on Slack's own consent screen. Nothing
 *   failed; they chose. The page must not read this as an error.
 * - `expired` — the round trip took longer than the state's lifetime. The
 *   slow-founder case, and the one that must never be confused with a forgery:
 *   pressing the button again works.
 * - `already-connected` — this organization already has an active connection.
 *   Settled by the partial unique index, never by a prior read, and what
 *   reaches the founder is a sentence about disconnecting the other one.
 * - `unavailable` — this installation has no Slack app configured. An
 *   operator's job, not the founder's; telling them to try again would send
 *   them at something they cannot change.
 * - `failed` — everything else: a state that did not verify, a code Slack
 *   refused, a call that did not complete. The honest instruction is to start
 *   the round trip again.
 */
export type SlackOAuthOutcome =
  "connected" | "declined" | "expired" | "already-connected" | "unavailable" | "failed";

const SLACK_OAUTH_OUTCOMES: readonly SlackOAuthOutcome[] = Object.freeze([
  "connected",
  "declined",
  "expired",
  "already-connected",
  "unavailable",
  "failed",
]);

/**
 * The outcome carried on a landing, or `null` for an ordinary visit.
 *
 * TOTAL, AND IT VALIDATES. The value arrives on a URL anybody can type, so an
 * unknown string is `null` — an ordinary visit — rather than a value the page
 * goes on to look up in a table it is not in. `null` and "something we do not
 * recognise" are the same next action: render the screen as it stands.
 */
export function slackOAuthOutcomeOf(search: URLSearchParams): SlackOAuthOutcome | null {
  const value = search.get(SLACK_OAUTH_OUTCOME_PARAM);
  return SLACK_OAUTH_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/**
 * Where the callback sends the founder, with the outcome attached.
 *
 * ONE PRODUCER, and it reads `ROUTES.firstRun` rather than the path: a retyped
 * route literal is a silent dead redirect the compiler cannot see, and
 * `apps/web/__tests__/routes.test.ts` scans for exactly that.
 */
export function firstRunLandingFor(outcome: SlackOAuthOutcome): string {
  return `${ROUTES.firstRun}?${SLACK_OAUTH_OUTCOME_PARAM}=${outcome}`;
}
