import { PostHog } from "posthog-node";

import { resolvePostHogHosts } from "./posthog-hosts";

import { logger } from "@growthmind/shared";
let posthogClient: PostHog | null = null;

// The test runner sets NODE_ENV itself, so this cannot be forgotten the way an unset
// variable can. Without it, a suite that creates users through the real auth hooks posts
// them to whatever project the machine is configured for (B-046).
export function isAnalyticsSuppressed(nodeEnv: string | undefined): boolean {
  return nodeEnv === "test";
}

export function getPostHogClient(): PostHog | null {
  if (isAnalyticsSuppressed(process.env.NODE_ENV)) return null;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      logger.error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      );
    }
    return null;
  }

  if (!posthogClient) {
    const { apiHost } = resolvePostHogHosts({
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      assetsHost: process.env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST,
      uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    });

    posthogClient = new PostHog(token, {
      host: apiHost,
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return posthogClient;
}
