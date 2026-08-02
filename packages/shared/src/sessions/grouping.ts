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
