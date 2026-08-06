import type { FindingText, TranscriptPullStop } from "@growthmind/db";
import type { SummarySource } from "@growthmind/shared";

import type { RecordingSourceState } from "@/lib/replay/deps";

export interface RecordingSummaryFacts {
  readonly text: FindingText;
  readonly summarySource: SummarySource;
  readonly pullStop: TranscriptPullStop | null;
}

export type RecordingSummaryRead =
  | { readonly kind: "read_failed" }
  | { readonly kind: "no_row"; readonly source: RecordingSourceState }
  | { readonly kind: "row"; readonly record: RecordingSummaryFacts };

export type RecordingSummaryStory =
  | {
      readonly kind: "resolved";
      readonly headline: string;
      readonly context: readonly string[];
      readonly summarySource: SummarySource;
      readonly partial: boolean;
    }
  | { readonly kind: "held" }
  | { readonly kind: "queued" }
  | { readonly kind: "no_source" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "read_failed" };

// A cap stopped the pull short of the whole recording just as a failure did, and only a failure
// is ever pulled again (recording-summaries.repo selects RETRYABLE_PULL_STOP alone), so a capped
// row is permanently the entire account the reader gets. Switched rather than listed: a new stop
// has to be classified here or this stops compiling.
function isPartialPull(pullStop: TranscriptPullStop | null): boolean {
  switch (pullStop) {
    case "page_cap":
    case "byte_cap":
    case "failed":
      return true;
    case "exhausted":
    case null:
      return false;
  }
}

export function resolveRecordingSummaryStory(read: RecordingSummaryRead): RecordingSummaryStory {
  if (read.kind === "read_failed") {
    return { kind: "read_failed" };
  }

  if (read.kind === "no_row") {
    switch (read.source) {
      case "ready":
        return { kind: "queued" };
      case "not_configured":
        return { kind: "not_configured" };
      // Both are answered by connecting or reconnecting at /settings, so they read the same.
      case "no_connection":
      case "unreadable_credential":
        return { kind: "no_source" };
    }
  }

  const { text, summarySource, pullStop } = read.record;

  // Held before partial: when the text cannot be shown at all, a caveat about it being
  // incomplete describes something the reader never sees.
  if (text.held) {
    return { kind: "held" };
  }

  return {
    kind: "resolved",
    headline: text.headline,
    context: text.context,
    summarySource,
    partial: isPartialPull(pullStop),
  };
}
