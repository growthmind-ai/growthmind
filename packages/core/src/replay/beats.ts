import type { TranscriptBeatKind } from "@growthmind/shared";

import type { CauseBeatEvidence } from "../cause/types";
import { describeElement } from "./describe";
import type { PersistedElement, PersistedSessionAction } from "./persisted-transcript";
import type { ElementIdentity, SessionActionKind } from "./types";

// The "something went wrong here" signal set the citation link's own label
// already uses (ADD Decision 4) — unchanged by this stage, only reused.
const NOTABLE_ACTION_KINDS: ReadonlySet<SessionActionKind> = new Set([
  "rage_click",
  "dead_click",
  "field_refocus",
  "field_abandoned",
]);

// Exhaustive over SessionActionKind: a new action kind added without a mapping
// decision here fails to compile, which is the correct place to force that
// decision (ADD Decision 4).
export function beatKindOf(kind: SessionActionKind): TranscriptBeatKind {
  switch (kind) {
    case "page":
      return "navigate";
    case "click":
    case "double_click":
    case "rage_click":
    case "dead_click":
      return "click";
    case "input":
    case "field_refocus":
    case "field_abandoned":
      return "input";
    case "scroll_back":
    case "wait":
      return "idle";
    case "ended":
      return "exit";
  }
}

// The stored beat carries no attribute map (persisted-transcript.ts), so a
// rehydrated element describes itself from the allow-listed fields only —
// same conversion persisted-transcript.ts's own rehydration performs.
function identityOf(element: PersistedElement): ElementIdentity {
  return {
    nodeId: element.nodeId,
    tagName: element.tag,
    classes: element.classes,
    attributes: {},
    ...(element.id === undefined ? {} : { id: element.id }),
    ...(element.role === undefined ? {} : { role: element.role }),
    ...(element.testId === undefined ? {} : { testId: element.testId }),
    ...(element.accessibleName === undefined ? {} : { accessibleName: element.accessibleName }),
  };
}

function beatTextOf(action: PersistedSessionAction): string {
  switch (action.kind) {
    case "page":
      return action.href ?? "";
    case "click":
    case "double_click":
    case "rage_click":
    case "dead_click":
    case "input":
    case "field_refocus":
    case "field_abandoned":
    case "scroll_back":
      return action.element === undefined ? "" : describeElement(identityOf(action.element));
    case "wait":
      return "waited";
    case "ended":
      return "session ended";
  }
}

function attemptOf(action: PersistedSessionAction): number | null {
  if (action.kind === "rage_click") return action.clicks ?? null;
  if (action.kind === "field_refocus") return action.focusCount ?? null;
  return null;
}

// Zero-based, input order, never reordered by kind — the citation gate's
// index space is exactly this array's own indices (ADD Decision 4, FR-2).
export function beatsFromActions(
  actions: readonly PersistedSessionAction[],
): readonly CauseBeatEvidence[] {
  return actions.map((action, index) => ({
    index,
    atMs: action.atMs,
    kind: beatKindOf(action.kind),
    text: beatTextOf(action),
    notable: NOTABLE_ACTION_KINDS.has(action.kind),
    attempt: attemptOf(action),
  }));
}

// A claim's citesHref/citesLabel are built from its first citation only — both the
// Slack renderer and the findings-page evidence builder resolve the same beat this way.
export function firstCitedBeat(
  beats: readonly CauseBeatEvidence[],
  citesBeats: readonly number[],
): CauseBeatEvidence | undefined {
  const index = citesBeats[0];
  return index === undefined ? undefined : beats[index];
}
