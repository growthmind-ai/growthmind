import { SOCIAL_PROVIDERS, type SocialProviderId } from "./social-auth";

// Passed to the plugin that writes it AND read by the pages, so the two ends cannot
// drift apart on a string. It is the Better Auth default; naming it keeps it ours.
export const LAST_LOGIN_METHOD_COOKIE = "better-auth.last_used_login_method";

export type LastLoginMethod = SocialProviderId | "email";

// The plugin also writes "passkey", "magic-link" and "siwe" for methods this app does
// not offer. An unrecognised value badges nothing rather than guessing a control.
function parse(value: string | undefined): LastLoginMethod | null {
  if (value === undefined) return null;
  if (value === "email") return "email";
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value)
    ? (value as SocialProviderId)
    : null;
}

// Email and password is enabled unconditionally, so only the social half can name a
// method whose control is no longer on the screen — pulling GITHUB_CLIENT_ID must not
// leave a badge floating where its button used to be.
export function resolveLastLoginBadge(
  cookieValue: string | undefined,
  providers: readonly SocialProviderId[],
): LastLoginMethod | null {
  const method = parse(cookieValue);

  if (method === null || method === "email") return method;
  return providers.includes(method) ? method : null;
}
