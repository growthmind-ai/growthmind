import posthog from "posthog-js";

// Self-hosted installs run without an analytics key; an uninitialised capture would log a
// vendor warning on every click instead of staying quiet.
export function instrument(event: string): void {
  if (posthog.__loaded) posthog.capture(event);
}
