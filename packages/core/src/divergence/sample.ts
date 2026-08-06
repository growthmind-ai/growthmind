import type { SessionTimeline } from "../detect/types";

function compareSessionsAscending(left: SessionTimeline, right: SessionTimeline): number {
  const byStartedAt = left.startedAt.getTime() - right.startedAt.getTime();
  if (byStartedAt !== 0) return byStartedAt;
  if (left.sessionId < right.sessionId) return -1;
  if (left.sessionId > right.sessionId) return 1;
  return 0;
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
