import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import type { SessionSummary } from "../analyse/types";

/**
 * The one line that decides every activation number this harness reports. It is an observable
 * event rather than a threshold, so nothing here is a magnitude anyone had to invent.
 */
export const ACTIVATION_DEFINITION =
  "A session connected something when the screen said back that a connection was made — the analytics it can see, the Slack workspace, the coding assistant, or the product reporting itself as running. Reaching the setup page, filling its fields and pressing Connect are not connecting.";

/** The fixed run of a message template, so a placeholder never has to be guessed at. */
export function literalOf(template: string): string {
  return (template.split(/\{[^}]*\}/)[0] ?? template).trim();
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The product's own words for a connection completing, imported rather than copied: a marker
 * pasted here would go on matching after the screen it names had been reworded.
 */
export const ACTIVATION_MARKERS: readonly string[] = [
  ONBOARDING_MESSAGES.setupSeeingHeading,
  ONBOARDING_MESSAGES.agentConnectedLine,
  ONBOARDING_MESSAGES.landingRunning,
  literalOf(ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate),
].map(normalise);

export function hasConnectedSomething(session: SessionSummary): boolean {
  return session.beats.some((beat) => {
    const line = normalise(beat.line);
    return ACTIVATION_MARKERS.some((marker) => line.includes(marker));
  });
}
