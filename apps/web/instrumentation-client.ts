import posthog from "posthog-js";

import { POSTHOG_PROXY_PATH, resolvePostHogHosts } from "./lib/posthog-hosts";
import { REPLAY_MASKING } from "./lib/replay-masking";
import { startReplayCapture } from "./lib/rrweb-capture";

import { logger } from "@growthmind/shared";
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (!token && process.env.NODE_ENV !== "production") {
  logger.error(
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
  );
}

if (token) {
  const { uiHost } = resolvePostHogHosts({
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    assetsHost: process.env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST,
    uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
  });

  posthog.init(token, {
    api_host: POSTHOG_PROXY_PATH,
    ui_host: uiHost,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
    session_recording: REPLAY_MASKING,
  });
}

startReplayCapture();
