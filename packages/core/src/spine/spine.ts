import { PERCENT_SCALE } from "../counts/percent";
import type { SessionTimeline } from "../detect/types";
import type { SessionPlacement, SpineOptions, SpineStep, StepSpine } from "./types";
import { SPINE_MIN_REACH_RATIO_PERCENT, STEP_SPINE_VERSION } from "./types";
import { comparePathsAscending, sessionWalk, surfaceNormalisationVersionOf } from "./walk";

const ORIGIN_INDEX = 0;
const FIRST_STEP_AFTER_ORIGIN = 1;

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 !== 0) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function walksReaching(
  sessions: readonly SessionTimeline[],
  surface: string,
): readonly (readonly string[])[] {
  const walkBySession = new Map<string, readonly string[]>();

  for (const session of sessions) {
    walkBySession.set(session.sessionId, sessionWalk(session));
  }

  return [...walkBySession.values()].filter((walk) => walk.includes(surface));
}

function firstOffsetsFromOrigin(
  walks: readonly (readonly string[])[],
  surface: string,
): ReadonlyMap<string, readonly number[]> {
  const offsetsByPath = new Map<string, number[]>();

  for (const walk of walks) {
    const seen = new Set<string>();

    for (const [offset, path] of walk.slice(walk.indexOf(surface)).entries()) {
      if (path === surface || seen.has(path)) continue;
      seen.add(path);

      const offsets = offsetsByPath.get(path) ?? [];
      offsets.push(offset);
      offsetsByPath.set(path, offsets);
    }
  }

  return offsetsByPath;
}

export function buildStepSpine(
  sessions: readonly SessionTimeline[],
  surface: string,
  options: SpineOptions = {},
): StepSpine {
  const minReachRatioPercent = options.minReachRatioPercent ?? SPINE_MIN_REACH_RATIO_PERCENT;
  const walks = walksReaching(sessions, surface);

  const origin: SpineStep = {
    path: surface,
    index: ORIGIN_INDEX,
    sessionsReaching: walks.length,
  };

  const ranked = [...firstOffsetsFromOrigin(walks, surface)]
    .map(([path, offsets]) => ({
      path,
      typicalOffset: median(offsets),
      sessionsReaching: offsets.length,
    }))
    .filter((step) => step.sessionsReaching * PERCENT_SCALE >= minReachRatioPercent * walks.length)
    .toSorted(
      (left, right) =>
        left.typicalOffset - right.typicalOffset ||
        right.sessionsReaching - left.sessionsReaching ||
        comparePathsAscending(left.path, right.path),
    );

  return {
    identity: {
      surface,

      surfaceNormalisationVersion: surfaceNormalisationVersionOf(sessions, surface),
      spineVersion: STEP_SPINE_VERSION,
    },
    minReachRatioPercent,
    steps: [
      origin,
      ...ranked.map((step, position) => ({
        path: step.path,
        index: position + FIRST_STEP_AFTER_ORIGIN,
        sessionsReaching: step.sessionsReaching,
      })),
    ],
  };
}

export function placeOnSpine(
  spine: StepSpine,
  sessions: readonly SessionTimeline[],
): readonly SessionPlacement[] {
  const indexByPath = new Map(spine.steps.map((step) => [step.path, step.index]));
  const origin = spine.identity.surface;

  return sessions.map((session) => {
    const walk = sessionWalk(session);
    const originVisits = walk.filter((path) => path === origin).length;

    const visited = new Set<number>();
    if (originVisits > 0) {
      for (const path of walk.slice(walk.indexOf(origin))) {
        const index = indexByPath.get(path);
        if (index !== undefined) visited.add(index);
      }
    }

    const visitedIndexes = [...visited].toSorted((left, right) => left - right);

    return {
      sessionId: session.sessionId,

      deepestVisitedIndex: visitedIndexes.at(-1) ?? null,
      visitedIndexes,
      originVisits,
    };
  });
}
