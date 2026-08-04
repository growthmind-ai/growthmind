import { SOCIAL_PROVIDERS, type SocialProviderId } from "./social-auth";

// The Better Auth default, named so the writer and the readers cannot drift apart.
export const LAST_LOGIN_METHOD_COOKIE = "better-auth.last_used_login_method";

export type LastLoginMethod = SocialProviderId | "email";

function parse(value: string | undefined): LastLoginMethod | null {
  if (value === undefined) return null;
  if (value === "email") return "email";
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value)
    ? (value as SocialProviderId)
    : null;
}

// A provider can leave the screen, and its badge must not outlive its button.
export function resolveLastLoginBadge(
  cookieValue: string | undefined,
  providers: readonly SocialProviderId[],
): LastLoginMethod | null {
  const method = parse(cookieValue);

  if (method === null || method === "email") return method;
  return providers.includes(method) ? method : null;
}
