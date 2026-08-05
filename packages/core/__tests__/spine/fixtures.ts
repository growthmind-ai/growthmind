import type { SessionTimeline, TimelineEvent } from "../../src/detect/types";

export const STARTED_AT = new Date("2026-07-03T09:00:00.000Z");
export const EVENT_STRIDE_MS = 1_000;
export const NORMALISATION_VERSION = 1;

export type SessionOptions = {
  readonly normalisationVersion?: number | null;
};

export function sessionOf(
  sessionId: string,
  paths: readonly (string | null)[],
  options: SessionOptions = {},
): SessionTimeline {
  const version =
    options.normalisationVersion === undefined
      ? NORMALISATION_VERSION
      : options.normalisationVersion;

  const events: readonly TimelineEvent[] = paths.map((urlPath, index) => ({
    sourceEventId: `${sessionId}-e${String(index)}`,
    name: "$pageview",
    occurredAt: new Date(STARTED_AT.getTime() + index * EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: urlPath === null ? null : version,
  }));

  return {
    sessionId,
    startedAt: STARTED_AT,
    exclusionReason: "none",
    entryUrlPath: paths[0] ?? null,
    events,
  };
}

export function pathsOf(spine: { readonly steps: readonly { readonly path: string }[] }): string[] {
  return spine.steps.map((step) => step.path);
}
