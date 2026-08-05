import { orderTimeline } from "../detect/order";
import type { SessionTimeline } from "../detect/types";

export function comparePathsAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sessionWalk(session: SessionTimeline): readonly string[] {
  const walk: string[] = [];
  let previous: string | null = null;

  for (const event of orderTimeline(session.events)) {
    const path = event.urlPath;
    if (path === null) continue;
    if (path !== previous) walk.push(path);
    previous = path;
  }

  return walk;
}

export function transitionsOf(
  walks: readonly (readonly string[])[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const transitions = new Map<string, Set<string>>();

  for (const walk of walks) {
    let previous: string | null = null;
    for (const path of walk) {
      if (previous !== null) {
        const destinations = transitions.get(previous) ?? new Set<string>();
        destinations.add(path);
        transitions.set(previous, destinations);
      }
      previous = path;
    }
  }

  return transitions;
}

export function surfaceNormalisationVersionOf(
  sessions: readonly SessionTimeline[],
  surface: string,
): number | null {
  const versions = sessions
    .flatMap((session) => session.events)
    .filter((event) => event.urlPath === surface)
    .map((event) => event.urlPathNormalisationVersion);

  const [first] = versions;
  return versions.every((version) => version === first) ? (first ?? null) : null;
}
