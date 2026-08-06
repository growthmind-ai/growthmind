import {
  RECORDING_FLOOR_ABANDONED_TEMPLATE,
  RECORDING_FLOOR_CLICKS_TEMPLATE,
  RECORDING_FLOOR_DEAD_CLICKS_TEMPLATE,
  RECORDING_FLOOR_HEADLINE_TEMPLATE,
  RECORDING_FLOOR_NO_PAGE,
  RECORDING_FLOOR_NOTHING,
  RECORDING_FLOOR_ONE_PAGE_TEMPLATE,
  RECORDING_FLOOR_PAGES_TEMPLATE,
  RECORDING_FLOOR_RAGE_TEMPLATE,
  RECORDING_FLOOR_REFOCUS_TEMPLATE,
  RECORDING_FLOOR_WITHHELD_CONTEXT,
  RECORDING_FLOOR_WITHHELD_HEADLINE,
} from "@growthmind/shared";
import { z } from "zod";

import { rehydratePersistedActions, type PersistedSessionAction } from "./persisted-transcript";
import { renderTranscript } from "./render";
import { tallyActions } from "./transcript";
import type { SessionAction, SessionActionKind, SessionTranscript } from "./types";

export const narrationOutputSchema = z.strictObject({
  headline: z.string().min(1),

  context: z.string().min(1),
});
export type NarrationOutput = z.infer<typeof narrationOutputSchema>;

export const NARRATION_MAX_ACTIONS = 120;

// A recording's raw event count is not small — a real 3-minute session measured 805 rrweb
// events — so the model reads a bounded digest, never the whole walk.
export const NOTABLE_KINDS: readonly SessionActionKind[] = [
  "dead_click",
  "rage_click",
  "field_refocus",
  "field_abandoned",
  "scroll_back",
];

export type TranscriptDigest = {
  readonly actions: readonly SessionAction[];
  readonly omitted: number;
  readonly pages: readonly string[];
  readonly durationMs: number;
  readonly counts: SessionTranscript["counts"];
  readonly droppedEvents: number;
};

function isNotable(action: SessionAction): boolean {
  return NOTABLE_KINDS.some((kind) => kind === action.kind);
}

// Priority first, document order second. Selecting by position alone would spend the whole
// budget on the opening of a long session and drop the rage click at the end, which is the
// one action the session is about.
function selectWithinBudget(
  all: readonly SessionAction[],
  budget: number,
): readonly SessionAction[] {
  const keep = new Set<number>();

  for (const [index, action] of all.entries()) {
    if (keep.size >= budget) break;
    if (isNotable(action) || action.kind === "page") keep.add(index);
  }

  for (let index = 0; index < all.length && keep.size < budget; index += 1) {
    keep.add(index);
  }

  return all.filter((_, index) => keep.has(index));
}

// Notable actions are why a session is worth reading, so they survive the budget whatever
// their position; the remainder fills in order, and what did not fit is counted rather
// than dropped silently.
export function compactTranscript(
  transcript: SessionTranscript,
  maxActions: number = NARRATION_MAX_ACTIONS,
): TranscriptDigest {
  const budget = Math.max(0, maxActions);
  const all = transcript.actions;

  const kept = all.length <= budget ? all : selectWithinBudget(all, budget);

  return {
    actions: kept,
    omitted: all.length - kept.length,
    pages: transcript.pages,
    durationMs: transcript.durationMs,
    counts: transcript.counts,
    droppedEvents: transcript.droppedEvents,
  };
}

export type HeldTranscript = {
  readonly actions: readonly PersistedSessionAction[];
  readonly omitted: number;
  readonly pages: readonly string[];
  readonly durationMs: number;
  readonly droppedEvents: number;
  readonly clockOriginAtMs: number | null;
};

export type ResumedTranscript = {
  readonly walk: SessionTranscript;
  readonly digest: TranscriptDigest;
};

function withoutTrailingEnd(actions: readonly SessionAction[]): readonly SessionAction[] {
  return actions.at(-1)?.kind === "ended" ? actions.slice(0, -1) : actions;
}

// The held half is what the row already carries, and the pulled half continues it on the same
// clock. `omitted` carries across because those beats are gone from the row, not from the
// recording — dropping the count would let a resumed row report fewer actions than it read.
// A continuation that read zero events reports no clock origin of its own — a rate-limited
// retry does this often — and falling back to the pulled side alone would forget the origin
// the held half was already measured from, landing its beats at atMs 0 instead of their true
// offset. The held origin is preserved whenever the pull has none to offer.
export function resumeDigest(held: HeldTranscript, pulled: SessionTranscript): ResumedTranscript {
  const actions = [
    ...withoutTrailingEnd(rehydratePersistedActions(held.actions)),
    ...pulled.actions,
  ];

  const walk: SessionTranscript = {
    actions,
    startedAt: pulled.startedAt,
    clockOriginAtMs: pulled.clockOriginAtMs ?? held.clockOriginAtMs,
    durationMs: Math.max(held.durationMs, pulled.durationMs),
    pages: [...new Set([...held.pages, ...pulled.pages])],
    counts: tallyActions(actions),
    droppedEvents: held.droppedEvents + pulled.droppedEvents,
  };

  const compacted = compactTranscript(walk);

  return { walk, digest: { ...compacted, omitted: compacted.omitted + held.omitted } };
}

const MS_PER_SECOND = 1_000;

const SECONDS_PER_MINUTE = 60;

function substitute(template: string, values: Readonly<Record<string, string>>): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export function describeSessionDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return minutes > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(seconds)}s`;
}

export type FloorNarration = {
  readonly headline: string;
  readonly context: readonly string[];
};

// What a recording says when no model wrote about it. Built only from measured facts, so it
// is true whatever the model did or did not do, and it is why a summary is always present.
export function renderRecordingFloor(digest: TranscriptDigest): FloorNarration {
  const headline = substitute(RECORDING_FLOOR_HEADLINE_TEMPLATE, {
    duration: describeSessionDuration(digest.durationMs),
  });

  const [onlyPage] = digest.pages;
  const where =
    digest.pages.length === 0
      ? RECORDING_FLOOR_NO_PAGE
      : digest.pages.length === 1 && onlyPage !== undefined
        ? substitute(RECORDING_FLOOR_ONE_PAGE_TEMPLATE, { page: onlyPage })
        : substitute(RECORDING_FLOOR_PAGES_TEMPLATE, { count: String(digest.pages.length) });

  const counts = digest.counts;
  const context: string[] = [where];

  if (counts.clicks > 0) {
    context.push(substitute(RECORDING_FLOOR_CLICKS_TEMPLATE, { count: String(counts.clicks) }));
  }
  if (counts.deadClicks > 0) {
    context.push(
      substitute(RECORDING_FLOOR_DEAD_CLICKS_TEMPLATE, { count: String(counts.deadClicks) }),
    );
  }
  if (counts.rageClicks > 0) {
    context.push(substitute(RECORDING_FLOOR_RAGE_TEMPLATE, { count: String(counts.rageClicks) }));
  }
  if (counts.refocuses > 0) {
    context.push(substitute(RECORDING_FLOOR_REFOCUS_TEMPLATE, { count: String(counts.refocuses) }));
  }
  if (counts.abandonedFields > 0) {
    context.push(
      substitute(RECORDING_FLOOR_ABANDONED_TEMPLATE, { count: String(counts.abandonedFields) }),
    );
  }

  if (digest.actions.length === 0 && digest.omitted === 0) {
    return { headline, context: [RECORDING_FLOOR_NOTHING] };
  }

  return { headline, context };
}

export function renderWithheldRecordingFloor(): FloorNarration {
  return {
    headline: RECORDING_FLOOR_WITHHELD_HEADLINE,
    context: [RECORDING_FLOOR_WITHHELD_CONTEXT],
  };
}

export function countNotable(actions: readonly SessionAction[]): number {
  return actions.filter((action) => isNotable(action)).length;
}

export function renderDigest(digest: TranscriptDigest): string {
  const transcript: SessionTranscript = {
    actions: digest.actions,
    startedAt: null,
    clockOriginAtMs: null,
    durationMs: digest.durationMs,
    pages: digest.pages,
    counts: digest.counts,
    droppedEvents: digest.droppedEvents,
  };

  const lines = [renderTranscript(transcript)];

  if (digest.omitted > 0) {
    lines.push(`(${String(digest.omitted)} further actions not shown)`);
  }

  return lines.join("\n");
}
