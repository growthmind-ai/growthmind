import { isFreeMailDomain } from "../exclusions/free-mail";
import type { ReplaySourceKind } from "../replay-source/types";

export const SESSION_GROUPING_VERSION = 1;

export const SESSION_BUCKET_MS = 30 * 60_000;

export interface SessionKeyInput {
  readonly postHogSessionId: string | null;

  readonly identityKey: string | null;
  readonly occurredAt: Date;

  readonly sourceEventId: string;
}

export function deriveSessionKey(input: SessionKeyInput): string {
  const postHogSessionId = input.postHogSessionId?.trim() ?? "";
  if (postHogSessionId.length > 0) return `ph:${postHogSessionId}`;

  const identityKey = input.identityKey?.trim() ?? "";
  if (identityKey.length > 0) {
    const bucket = Math.floor(input.occurredAt.getTime() / SESSION_BUCKET_MS);
    return `gm:${identityKey}:${bucket}`;
  }

  return `gm:anon:${input.sourceEventId}`;
}

const UNUSED_ON_THE_POSTHOG_BRANCH = new Date(0);

export function recordingSessionKey(
  provider: ReplaySourceKind,
  recordingId: string,
): string | null {
  if (provider !== "posthog") return null;

  const postHogSessionId = recordingId.trim();
  if (postHogSessionId.length === 0) return null;

  return deriveSessionKey({
    postHogSessionId,
    identityKey: null,
    occurredAt: UNUSED_ON_THE_POSTHOG_BRANCH,
    sourceEventId: recordingId,
  });
}

export interface GroupableSessionFact {
  readonly identityEmailDomain: string;
  readonly startedAt: Date;
}

export interface AccountGroup {
  readonly domain: string;
  readonly sessionCount: number;
  readonly mostRecentSessionAt: Date;
}

export function groupSessionsByDomain(
  sessions: readonly GroupableSessionFact[],
): readonly AccountGroup[] {
  const groups = new Map<string, { count: number; mostRecentSessionAt: Date }>();

  for (const session of sessions) {
    if (isFreeMailDomain(session.identityEmailDomain)) continue;

    const existing = groups.get(session.identityEmailDomain);
    if (existing === undefined) {
      groups.set(session.identityEmailDomain, {
        count: 1,
        mostRecentSessionAt: session.startedAt,
      });
      continue;
    }

    existing.count += 1;
    if (session.startedAt > existing.mostRecentSessionAt) {
      existing.mostRecentSessionAt = session.startedAt;
    }
  }

  return [...groups.entries()]
    .map(([domain, g]) => ({ domain, sessionCount: g.count, mostRecentSessionAt: g.mostRecentSessionAt }))
    .toSorted((a, b) => b.mostRecentSessionAt.getTime() - a.mostRecentSessionAt.getTime());
}

export function recordingIdFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith("ph:")) return null;
  const id = sessionKey.slice(3);
  return id.length > 0 ? id : null;
}
