import { describeElement } from "./describe";
import type { SessionAction, SessionTranscript } from "./types";

export const MS_PER_SECOND = 1_000;

export const SECONDS_PER_MINUTE = 60;

export const STAMP_SEPARATOR = "  ";

export const EMPTY_TRANSCRIPT_LINE = "(nothing recorded)";

function stamp(atMs: number): string {
  const totalSeconds = Math.floor(atMs / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function sentence(action: SessionAction): string {
  switch (action.kind) {
    case "page":
      return `opened ${action.href}`;
    case "click":
      return `clicked ${describeElement(action.element)}`;
    case "double_click":
      return `double-clicked ${describeElement(action.element)}`;
    case "rage_click":
      return `rage-clicked ${describeElement(action.element)} (${String(action.clicks)} clicks in ${String(action.spanMs)}ms)`;
    case "dead_click":
      return `clicked ${describeElement(action.element)} — nothing happened`;
    case "input":
      return `typed into ${describeElement(action.element)}`;
    case "field_refocus":
      return `came back to ${describeElement(action.element)} (focus ${String(action.focusCount)})`;
    case "field_abandoned":
      return `left ${describeElement(action.element)} without typing`;
    case "scroll_back":
      return `scrolled back on ${describeElement(action.element)}`;
    case "wait":
      return `waited ${String(Math.round(action.durationMs / MS_PER_SECOND))}s`;
    case "ended":
      return "session ended";
  }
}

export function renderTranscript(transcript: SessionTranscript): string {
  const lines = transcript.actions.map(
    (action) => `${stamp(action.atMs)}${STAMP_SEPARATOR}${sentence(action)}`,
  );

  if (transcript.droppedEvents > 0) {
    lines.push(`(${String(transcript.droppedEvents)} malformed events dropped)`);
  }

  return lines.length === 0 ? EMPTY_TRANSCRIPT_LINE : lines.join("\n");
}
