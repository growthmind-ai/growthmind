import { readFileSync } from "node:fs";

import { buildTranscript, EMPTY_TRANSCRIPT_LINE, renderTranscript } from "@growthmind/core";
import { rrwebEventSchema } from "@growthmind/shared";
import type { SessionTranscript } from "@growthmind/core";

import type { Beat, SessionSummary } from "../analyse/types";
import type { ConsoleErrorRecord } from "../protocol";
import { assertHarnessNoiseUnchanged, attributeConsoleErrors } from "./console-attribution";
import type { PersonaSessionResult } from "./run-persona";

/** The renderer's empty sentinel is dropped: a citation of "(nothing recorded)" checks out. */
export function beatsOf(rendered: string): readonly Beat[] {
  if (rendered.trim().length === 0 || rendered.trim() === EMPTY_TRANSCRIPT_LINE) return [];
  return rendered
    .split("\n")
    .map((line, position) => ({ index: position + 1, line }))
    .filter((beat) => beat.line.trim().length > 0);
}

export interface SummariseInput {
  readonly sessionId: string;
  readonly outcome: SessionSummary["outcome"];
  readonly exitReason: string | null;
  readonly consoleErrors: readonly ConsoleErrorRecord[];
  readonly appOrigin: string;
  readonly urlTrail: readonly string[];
}

export function collapseUrlTrail(urls: readonly string[]): readonly string[] {
  return urls.filter((url, position) => position === 0 || urls[position - 1] !== url);
}

export function summariseTranscript(
  transcript: SessionTranscript,
  input: SummariseInput,
): SessionSummary {
  const attributed = attributeConsoleErrors(input.consoleErrors, input.appOrigin);

  return {
    sessionId: input.sessionId,
    outcome: input.outcome,
    pages: [...transcript.pages],
    urlTrail: [...collapseUrlTrail(input.urlTrail)],
    durationMs: transcript.durationMs,
    counts: { ...transcript.counts },
    beats: [...beatsOf(renderTranscript(transcript))],
    consoleErrorCount: attributed.app.length,
    consoleErrors: [...attributed.app],
    exitReason: input.exitReason,
  };
}

export interface RecordedSessionFile {
  readonly events: readonly unknown[];
}

export interface ReplayReadResult {
  readonly summary: SessionSummary;
  readonly eventsAccepted: number;
  readonly eventsSeen: number;
}

/** Events go through the production schema and the production transcript builder, not a copy. */
export function summariseRecordedSession(
  result: PersonaSessionResult,
  options: { readonly includeExitReason: boolean; readonly appOrigin: string },
): ReplayReadResult {
  assertHarnessNoiseUnchanged(result.sessionId, result.consoleErrors, options.appOrigin);

  const events: readonly unknown[] =
    result.sessionPath === null
      ? []
      : (JSON.parse(readFileSync(result.sessionPath, "utf8")) as RecordedSessionFile).events;

  const accepted = events.flatMap((event) => {
    const parsed = rrwebEventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  });

  const transcript = buildTranscript(accepted);

  return {
    summary: summariseTranscript(transcript, {
      sessionId: result.sessionId,
      outcome: result.outcome,
      exitReason: options.includeExitReason ? result.outcomeReason : null,
      consoleErrors: result.consoleErrors,
      appOrigin: options.appOrigin,
      urlTrail: [
        ...result.steps.map((step) => step.url),
        ...(result.finalUrl === null ? [] : [result.finalUrl]),
      ],
    }),
    eventsAccepted: accepted.length,
    eventsSeen: events.length,
  };
}
