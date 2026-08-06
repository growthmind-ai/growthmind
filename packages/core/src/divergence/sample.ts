import type { SessionTimeline } from "../detect/types";
import { comparePathsAscending } from "../spine/walk";

function compareSessionsAscending(left: SessionTimeline, right: SessionTimeline): number {
  const byStartedAt = left.startedAt.getTime() - right.startedAt.getTime();
  if (byStartedAt !== 0) return byStartedAt;
  return comparePathsAscending(left.sessionId, right.sessionId);
}

export function sampleSessionIds(
  sessions: readonly SessionTimeline[],
  limit: number,
): readonly string[] {
  return sessions
    .toSorted(compareSessionsAscending)
    .slice(0, limit)
    .map((session) => session.sessionId);
}
