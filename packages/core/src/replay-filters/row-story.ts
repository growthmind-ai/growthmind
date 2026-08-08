import type { ReplayListRow } from "./select";

// A display bound, and `morePages` states what it cut. See
// .ai/decisions/0022-record-page-display-limits.md.
export const REPLAY_ROW_PAGE_TAG_CAP = 4;

// Three states, not two. "held" is a narration that was written and withheld, and the detail
// page says so — a row calling it "not written yet" contradicts the card it links to.
export type ReplayRowNarration = "written" | "held" | "none";

export interface ReplayRowSummary {
  readonly headline: string | null;
  readonly held: boolean;
  readonly pages: readonly string[];
}

export interface ReplayRowStory {
  readonly title: string;
  readonly narration: ReplayRowNarration;
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

function narrationOf(summary: ReplayRowSummary | null, narrated: boolean): ReplayRowNarration {
  if (narrated) return "written";
  return summary?.held === true ? "held" : "none";
}

export function replayRowStory(
  row: ReplayListRow,
  summary: ReplayRowSummary | null,
): ReplayRowStory {
  const headline = summary?.headline ?? null;
  const narrated = headline !== null && !blank(headline);

  const title = narrated ? headline.trim() : (row.entryUrlPath ?? row.recordingId);
  const pages = pagesOf(row, summary);

  // A single tag repeating the title is noise, and on an un-narrated row it is the same path
  // printed twice.
  const tags = pages.length === 1 && pages[0] === title ? [] : pages;

  return {
    title,
    narration: narrationOf(summary, narrated),
    pages: tags.slice(0, REPLAY_ROW_PAGE_TAG_CAP),
    morePages: Math.max(0, tags.length - REPLAY_ROW_PAGE_TAG_CAP),
  };
}
