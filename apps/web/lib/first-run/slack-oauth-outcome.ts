import { ROUTES } from "@/lib/routes";

export const SLACK_OAUTH_OUTCOME_PARAM = "slack";

// Six values, total by type, so a seventh outcome is a compile error rather than a branch
// nobody wrote. The sentences a founder reads deliberately live in the audited copy home
// (`packages/shared/src/onboarding/messages.ts`); only the vocabulary is here.
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

export function slackOAuthOutcomeOf(search: URLSearchParams): SlackOAuthOutcome | null {
  const value = search.get(SLACK_OAUTH_OUTCOME_PARAM);
  return SLACK_OAUTH_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

// Setup redirects a dismissed founder home and drops the parameter, so the
// surface the founder left is the only landing that keeps the outcome sentence.
export function slackOAuthLandingFor(input: {
  readonly outcome: SlackOAuthOutcome;
  readonly dismissed: boolean;
}): string {
  const base = input.dismissed ? ROUTES.settings : ROUTES.firstRun;
  return `${base}?${SLACK_OAUTH_OUTCOME_PARAM}=${input.outcome}`;
}
