import posthog from "posthog-js";

import { POSTHOG_PROXY_PATH, resolvePostHogHosts } from "./lib/posthog-hosts";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (!token && process.env.NODE_ENV !== "production") {
  console.error(
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
  );
}

if (token) {
  // Read as LITERAL `process.env.NEXT_PUBLIC_*` member accesses — that is the only
  // form Next.js inlines into the client bundle at build time. Handing the values to
  // the resolver keeps the region logic in one tested place (see posthog-hosts.ts).
  const { uiHost } = resolvePostHogHosts({
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    assetsHost: process.env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST,
    uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
  });

  posthog.init(token, {
    // The same-origin proxy, rewritten in next.config.ts to whichever PostHog this
    // deployment points at. Never the api host directly: an ad-blocker drops that
    // request and the app's own analytics go quiet with no error anywhere.
    api_host: POSTHOG_PROXY_PATH,
    ui_host: uiHost,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
}
