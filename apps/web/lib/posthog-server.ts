import { PostHog } from "posthog-node";

import { resolvePostHogHosts } from "./posthog-hosts";

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      );
    }
    return null;
  }

  if (!posthogClient) {
    // Server-side, so no build-time inlining is involved — but the variables are the
    // same ones the browser reads, deliberately: one PostHog deployment, one set of
    // hosts, whether the event originates on the server or the client.
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
