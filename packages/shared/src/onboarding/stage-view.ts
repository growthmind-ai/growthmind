import { ANALYSIS_OUTCOME_MESSAGES, ANALYSIS_RUN_STATUS_MESSAGES } from "../summary/messages";
import {
  STAGE_DELIVERED_TEMPLATE,
  STAGE_DELIVERY_FAILED_TEMPLATE,
  STAGE_DELIVERY_PENDING_TEMPLATE,
  STAGE_ENDED_HINT,
  STAGE_FOUND_HEADING,
  STAGE_FOUND_HINT,
  STAGE_LOG_ARMED,
  STAGE_LOG_READING,
  STAGE_LOG_RETRIEVED,
  STAGE_READING_HEADING,
  STAGE_READING_HINT,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
  STAGE_WATCHING_HEADING,
  STAGE_WATCHING_HINT,
} from "./messages";
import type { RenderedStageState } from "./stage";
import type { EndedReason, FirstRunDeliveryState } from "./types";

export type StageLogLine = {
  readonly atSeconds: number;

  readonly text: string;
};

export type StageView = {
  readonly heading: string;
  readonly hint: string;
  readonly lines: readonly StageLogLine[];
  readonly elapsedSeconds: number;
};

const DELIVERY_TEMPLATES: Record<Exclude<FirstRunDeliveryState, "none">, string> = {
  posted: STAGE_DELIVERED_TEMPLATE,
  unposted: STAGE_DELIVERY_PENDING_TEMPLATE,
  failed: STAGE_DELIVERY_FAILED_TEMPLATE,
};

export function renderDeliveryLine(
  state: FirstRunDeliveryState,
  channelId: string | null,
): string | null {
  if (state === "none" || channelId === null) {
    return null;
  }

  return DELIVERY_TEMPLATES[state].replaceAll("{channel}", channelId);
}

const ENDED_HEADINGS: Record<EndedReason, string> = {
  failed: ANALYSIS_RUN_STATUS_MESSAGES.failed,
  no_candidates_passed_gate: ANALYSIS_OUTCOME_MESSAGES.no_candidates_passed_gate,
  no_sessions_to_analyse: ANALYSIS_OUTCOME_MESSAGES.no_sessions_to_analyse,
};

function stampOf(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

const line = (atSeconds: number, text: string): StageLogLine => ({ atSeconds, text });

function logFor(
  elapsedSeconds: number,
  retrievedAtSeconds: number | null | undefined,
  readingAtSeconds: number | null | undefined,
  readingAssured: boolean,
): readonly StageLogLine[] {
  const lines: StageLogLine[] = [line(0, STAGE_LOG_ARMED)];

  const retrieved = stampOf(retrievedAtSeconds);
  if (retrieved !== null) {
    lines.push(line(retrieved, STAGE_LOG_RETRIEVED));
  }

  const reading = stampOf(readingAtSeconds);
  if (reading !== null) {
    lines.push(line(reading, STAGE_LOG_READING));
  } else if (readingAssured) {
    lines.push(line(Math.max(0, Math.round(elapsedSeconds)), STAGE_LOG_READING));
  }

  return lines;
}

export function renderStageView(state: RenderedStageState): StageView {
  switch (state.kind) {
    case "unarmed":
      return {
        heading: STAGE_UNARMED_HEADING,
        hint: STAGE_UNARMED_HINT,
        lines: [],
        elapsedSeconds: 0,
      };

    case "leg1":
      return {
        heading: STAGE_WATCHING_HEADING,
        hint: STAGE_WATCHING_HINT,
        lines: logFor(
          state.elapsedSeconds,
          state.retrievedAtSeconds,
          state.readingAtSeconds,
          false,
        ),
        elapsedSeconds: state.elapsedSeconds,
      };

    case "leg2":
      return {
        heading: STAGE_READING_HEADING,
        hint: STAGE_READING_HINT,
        lines: logFor(state.elapsedSeconds, state.retrievedAtSeconds, state.readingAtSeconds, true),
        elapsedSeconds: state.elapsedSeconds,
      };

    case "finding":
      return {
        heading: STAGE_FOUND_HEADING,
        hint: STAGE_FOUND_HINT,
        lines: logFor(
          state.elapsedSeconds,
          state.retrievedAtSeconds,
          state.readingAtSeconds,
          false,
        ),
        elapsedSeconds: state.elapsedSeconds,
      };

    case "ended":
      return {
        heading: ENDED_HEADINGS[state.reason],
        hint: STAGE_ENDED_HINT,
        lines: logFor(
          state.elapsedSeconds,
          state.retrievedAtSeconds,
          state.readingAtSeconds,
          false,
        ),
        elapsedSeconds: state.elapsedSeconds,
      };
  }
}
