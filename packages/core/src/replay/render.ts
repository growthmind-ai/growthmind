import { describeElement } from "./describe";
import type { ReactionKind, SessionAction, SessionTranscript } from "./types";

export const MS_PER_SECOND = 1_000;

export const SECONDS_PER_MINUTE = 60;

export const STAMP_SEPARATOR = "  ";

export const EMPTY_TRANSCRIPT_LINE = "(nothing recorded)";

export function stampOf(atMs: number): string {
  const totalSeconds = Math.floor(atMs / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export const REACTION_WITHHELD_ERROR = "an error";

export const REACTION_WITHHELD_MESSAGE = "a message";

// The words when the gate passed them, and what kind of thing it was when it did not. Never
// nothing: a reaction that renders as no line reads as a screen that stayed silent.
export function reactionPhrase(reaction: ReactionKind, text: string | undefined): string {
  if (text !== undefined) return `"${text}"`;
  return reaction === "error" ? REACTION_WITHHELD_ERROR : REACTION_WITHHELD_MESSAGE;
}

export const PAGE_WITHHELD_LOCATION = "a page whose address was withheld";

const PAGE_HOST = /^[a-z][\w+.-]*:\/\/([^/?#\s]+)/i;

export function hostOf(href: string): string | null {
  return PAGE_HOST.exec(href)?.[1] ?? null;
}

function sentence(action: SessionAction, cameFrom: string | null): string {
  switch (action.kind) {
    case "page": {
      if (action.href === undefined) return `opened ${PAGE_WITHHELD_LOCATION}`;

      const host = hostOf(action.href);
      // A recording stops at the edge of its own origin, so the last thing it can say about
      // someone who left is where they went (B-060).
      const departed = host !== null && cameFrom !== null && host !== cameFrom;
      return departed ? `left for ${host}` : `opened ${action.href}`;
    }
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
    case "reaction":
      return `saw ${reactionPhrase(action.reaction, action.text)}`;
    case "wait":
      return `waited ${String(Math.round(action.durationMs / MS_PER_SECOND))}s`;
    case "ended":
      return "session ended";
  }
}

export function renderTranscript(transcript: SessionTranscript): string {
  let cameFrom: string | null = null;

  const lines = transcript.actions.map((action) => {
    const line = `${stampOf(action.atMs)}${STAMP_SEPARATOR}${sentence(action, cameFrom)}`;
    if (action.kind === "page" && action.href !== undefined) {
      cameFrom = hostOf(action.href) ?? cameFrom;
    }

    return line;
  });

  if (transcript.droppedEvents > 0) {
    lines.push(`(${String(transcript.droppedEvents)} malformed events dropped)`);
  }

  return lines.length === 0 ? EMPTY_TRANSCRIPT_LINE : lines.join("\n");
}
