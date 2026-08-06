import type { AccountGroup } from "@growthmind/shared";
import type { FindingText, SessionRecord } from "@growthmind/db";

export type CompanySessionStory =
  | { readonly kind: "resolved"; readonly headline: string; readonly context: readonly string[] }
  | { readonly kind: "held" }
  | { readonly kind: "pending" }
  | { readonly kind: "no_recording" };

// `recordingId === null` is checked first and unconditionally: without a recording there is
// nothing to watch, so any summary text passed alongside it (a stale row, a race) never gets
// a say in the story.
export function resolveCompanySessionStory(
  recordingId: string | null,
  text: FindingText | null,
): CompanySessionStory {
  if (recordingId === null) return { kind: "no_recording" };
  if (text === null) return { kind: "pending" };
  if (text.held) return { kind: "held" };
  return { kind: "resolved", headline: text.headline, context: text.context };
}

export interface CompanySessionDTO {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly entryUrlPath: string | null;
  readonly recordingId: string | null;
  readonly story: CompanySessionStory;
}

export function toCompanySessionDto(
  session: SessionRecord,
  recordingId: string | null,
  story: CompanySessionStory,
): CompanySessionDTO {
  return {
    sessionId: session.id,
    startedAt: session.startedAt.toISOString(),
    entryUrlPath: session.entryUrlPath,
    recordingId,
    story,
  };
}

export interface CompanyGroupDTO {
  readonly domain: string;
  readonly sessionCount: number;
  readonly mostRecentSessionAt: string;
}

export function toCompanyGroupDto(group: AccountGroup): CompanyGroupDTO {
  return {
    domain: group.domain,
    sessionCount: group.sessionCount,
    mostRecentSessionAt: group.mostRecentSessionAt.toISOString(),
  };
}
