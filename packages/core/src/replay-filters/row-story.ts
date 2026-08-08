import type { ReplayListRow } from "./select";

// A display bound, and `morePages` states what it cut. See
// .ai/decisions/0022-record-page-display-limits.md.
export const REPLAY_ROW_PAGE_TAG_CAP = 4;

// What the narration knows about one recording. Null headline is "nothing readable to show" —
// never narrated, or narrated and held — and the row must read the same in both cases.
export interface ReplayRowSummary {
  readonly headline: string | null;
  readonly pages: readonly string[];
}

export interface ReplayRowStory {
  readonly title: string;
  readonly fromHeadline: boolean;
  readonly pages: readonly string[];
  readonly morePages: number;
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

// The entry path is the one page every session knows. It stands in when the narration lists no
// pages, so a row whose title is a headline never loses the path entirely.
function pagesOf(row: ReplayListRow, summary: ReplayRowSummary | null): readonly string[] {
  const listed = (summary?.pages ?? []).filter((page) => !blank(page));
  if (listed.length > 0) return [...new Set(listed)];

  return row.entryUrlPath === null ? [] : [row.entryUrlPath];
}

export function replayRowStory(
  row: ReplayListRow,
  summary: ReplayRowSummary | null,
): ReplayRowStory {
  const headline = summary?.headline ?? null;
  const narrated = headline !== null && !blank(headline);

  const pages = pagesOf(row, summary);

  return {
    title: narrated ? headline.trim() : (row.entryUrlPath ?? row.recordingId),
    fromHeadline: narrated,
    pages: pages.slice(0, REPLAY_ROW_PAGE_TAG_CAP),
    morePages: Math.max(0, pages.length - REPLAY_ROW_PAGE_TAG_CAP),
  };
}
