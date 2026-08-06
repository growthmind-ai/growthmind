import type { RrwebEvent } from "@growthmind/shared";

import type { DomSegments } from "./nodes";
import { indexDomSegments, resolveControlAt, resolveIdentityAt } from "./nodes";
import type { ReplayFact } from "./parse";
import { RRWEB_MOUSE_INTERACTION, readReplayEvents } from "./parse";
import type { ElementIdentity, SessionAction } from "./types";

// Two clicks is a mis-click or a double-click; three is a person repeating themselves.
export const RAGE_CLICK_MIN_CLICKS = 3;

// Repeats further apart than a second are a person retrying, not a person hammering.
export const RAGE_CLICK_WINDOW_MS = 1_000;

// A responsive page mutates its DOM well inside two seconds; silence past here means it did not answer.
export const DEAD_CLICK_WINDOW_MS = 2_000;

// Under ten seconds a gap is reading; over it the person stopped, which is the thing worth a line.
export const WAIT_THRESHOLD_MS = 10_000;

// Trackpad jitter moves a few pixels; forty is a decision to go back rather than noise.
export const SCROLL_BACK_MIN_PX = 40;

// The first focus is just arriving at a field; the second is the one that means something.
export const FIELD_REFOCUS_MIN_FOCUSES = 2;

// Abandonment and refocus are claims about fields, so they are made only about fields.
export const FIELD_TAG_NAMES: readonly string[] = ["input", "textarea", "select"];

type Draft = {
  readonly atMs: number;

  readonly order: number;
  readonly action: SessionAction;
};

type ClickPoint = {
  readonly tsMs: number;
  readonly order: number;
  readonly element: ElementIdentity;
};

type ScrollState = {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
};

function isFieldElement(element: ElementIdentity): boolean {
  return FIELD_TAG_NAMES.includes(element.tagName);
}

function pageDrafts(facts: readonly ReplayFact[], firstTsMs: number): readonly Draft[] {
  const drafts: Draft[] = [];
  let shown: string | null = null;

  for (const [order, fact] of facts.entries()) {
    if (fact.kind !== "page" || fact.href === shown) continue;
    shown = fact.href;

    const atMs = fact.tsMs - firstTsMs;
    drafts.push({ atMs, order, action: { kind: "page", atMs, href: fact.href } });
  }

  return drafts;
}

function clickDrafts(
  facts: readonly ReplayFact[],
  segments: DomSegments,
  firstTsMs: number,
): readonly Draft[] {
  const clicks: ClickPoint[] = [];
  const mutationTimes: number[] = [];

  for (const [order, fact] of facts.entries()) {
    if (fact.kind === "mutation") {
      mutationTimes.push(fact.tsMs);
      continue;
    }
    if (fact.kind === "mouse" && fact.interaction === RRWEB_MOUSE_INTERACTION.click) {
      const element = resolveControlAt(segments, fact.nodeId, fact.tsMs);
      clicks.push({ tsMs: fact.tsMs, order, element });
    }
  }

  const drafts: Draft[] = [];
  let cursor = 0;

  while (cursor < clicks.length) {
    const head = clicks[cursor];
    let end = cursor + 1;
    // Repeats are counted on the resolved control: hammering one button reaches rrweb as
    // clicks on whichever icon or label the pointer happened to be over.
    while (
      end < clicks.length &&
      clicks[end].element.nodeId === head.element.nodeId &&
      clicks[end].tsMs - head.tsMs <= RAGE_CLICK_WINDOW_MS
    ) {
      end += 1;
    }

    const element = head.element;
    const atMs = head.tsMs - firstTsMs;
    const run = end - cursor;

    if (run >= RAGE_CLICK_MIN_CLICKS) {
      drafts.push({
        atMs,
        order: head.order,
        action: {
          kind: "rage_click",
          atMs,
          element,
          clicks: run,
          spanMs: clicks[end - 1].tsMs - head.tsMs,
        },
      });
      cursor = end;
      continue;
    }

    const answered = mutationTimes.some(
      (tsMs) => tsMs >= head.tsMs && tsMs - head.tsMs <= DEAD_CLICK_WINDOW_MS,
    );
    drafts.push({
      atMs,
      order: head.order,
      action: answered ? { kind: "click", atMs, element } : { kind: "dead_click", atMs, element },
    });
    cursor += 1;
  }

  return drafts;
}

function axisMove(
  previous: number,
  next: number,
  direction: number,
): { readonly direction: number; readonly reversed: boolean } {
  const delta = next - previous;
  if (Math.abs(delta) < SCROLL_BACK_MIN_PX) return { direction, reversed: false };

  const heading = delta > 0 ? 1 : -1;
  return { direction: heading, reversed: direction !== 0 && heading !== direction };
}

function sequentialDrafts(
  facts: readonly ReplayFact[],
  segments: DomSegments,
  firstTsMs: number,
): readonly Draft[] {
  const drafts: Draft[] = [];
  const focusCounts = new Map<number, number>();
  const openFocus = new Map<number, boolean>();
  const scrolls = new Map<number, ScrollState>();
  let typingNodeId: number | null = null;

  for (const [order, fact] of facts.entries()) {
    const atMs = fact.tsMs - firstTsMs;

    if (fact.kind === "mouse") {
      const element = resolveControlAt(segments, fact.nodeId, fact.tsMs);

      if (fact.interaction === RRWEB_MOUSE_INTERACTION.doubleClick) {
        drafts.push({ atMs, order, action: { kind: "double_click", atMs, element } });
        continue;
      }

      if (fact.interaction === RRWEB_MOUSE_INTERACTION.focus) {
        typingNodeId = null;
        if (!isFieldElement(element)) continue;

        const focusCount = (focusCounts.get(element.nodeId) ?? 0) + 1;
        focusCounts.set(element.nodeId, focusCount);
        openFocus.set(element.nodeId, false);

        if (focusCount >= FIELD_REFOCUS_MIN_FOCUSES) {
          drafts.push({
            atMs,
            order,
            action: { kind: "field_refocus", atMs, element, focusCount },
          });
        }
        continue;
      }

      if (fact.interaction === RRWEB_MOUSE_INTERACTION.blur) {
        typingNodeId = null;
        const typed = openFocus.get(element.nodeId);
        openFocus.delete(element.nodeId);

        if (typed === false && isFieldElement(element)) {
          drafts.push({ atMs, order, action: { kind: "field_abandoned", atMs, element } });
        }
      }
      continue;
    }

    if (fact.kind === "input") {
      const element = resolveIdentityAt(segments, fact.nodeId, fact.tsMs);
      if (openFocus.has(element.nodeId)) openFocus.set(element.nodeId, true);
      if (typingNodeId === element.nodeId) continue;

      typingNodeId = element.nodeId;
      drafts.push({ atMs, order, action: { kind: "input", atMs, element } });
      continue;
    }

    if (fact.kind !== "scroll") continue;

    const previous = scrolls.get(fact.nodeId);
    if (previous === undefined) {
      scrolls.set(fact.nodeId, { x: fact.x, y: fact.y, dirX: 0, dirY: 0 });
      continue;
    }

    const horizontal = axisMove(previous.x, fact.x, previous.dirX);
    const vertical = axisMove(previous.y, fact.y, previous.dirY);
    scrolls.set(fact.nodeId, {
      x: fact.x,
      y: fact.y,
      dirX: horizontal.direction,
      dirY: vertical.direction,
    });

    if (horizontal.reversed || vertical.reversed) {
      const element = resolveIdentityAt(segments, fact.nodeId, fact.tsMs);
      drafts.push({ atMs, order, action: { kind: "scroll_back", atMs, element } });
    }
  }

  return drafts;
}

function withWaitsAndEnd(
  actions: readonly SessionAction[],
  endedAtMs: number,
): readonly SessionAction[] {
  const ended: SessionAction = { kind: "ended", atMs: endedAtMs };
  const transcript: SessionAction[] = [];

  for (const action of [...actions, ended]) {
    const previous = transcript.at(-1);
    if (previous !== undefined) {
      const durationMs = action.atMs - previous.atMs;
      if (durationMs > WAIT_THRESHOLD_MS) {
        transcript.push({ kind: "wait", atMs: previous.atMs, durationMs });
      }
    }
    transcript.push(action);
  }

  return transcript;
}

function fromZero(action: SessionAction, originMs: number): SessionAction {
  return { ...action, atMs: action.atMs - originMs };
}

export type ActionWalk = {
  readonly actions: readonly SessionAction[];

  readonly clockOriginAtMs: number | null;
};

const NO_WALK: ActionWalk = { actions: [], clockOriginAtMs: null };

// A resumed pull carries the instant its predecessor's clock started, so its beats stamp onto
// the same timeline rather than restarting at 0:00 a second time.
export function walkActions(
  events: readonly RrwebEvent[],
  clockOriginAtMs: number | null = null,
): ActionWalk {
  const { facts, firstTsMs, lastTsMs } = readReplayEvents(events);
  if (firstTsMs === null || lastTsMs === null) return NO_WALK;

  const segments = indexDomSegments(events);
  const drafts = [
    ...pageDrafts(facts, firstTsMs),
    ...clickDrafts(facts, segments, firstTsMs),
    ...sequentialDrafts(facts, segments, firstTsMs),
  ];

  const ordered = drafts.toSorted(
    (left, right) => left.atMs - right.atMs || left.order - right.order,
  );

  // The clock starts at the first thing the person did, so a recording that idled for an
  // hour before its first action still reads from 0:00.
  const originMs =
    clockOriginAtMs === null ? (ordered.at(0)?.atMs ?? 0) : clockOriginAtMs - firstTsMs;
  const actions = ordered.map((draft) => fromZero(draft.action, originMs));

  return {
    actions: withWaitsAndEnd(actions, lastTsMs - firstTsMs - originMs),
    clockOriginAtMs: firstTsMs + originMs,
  };
}

export function toActions(events: readonly RrwebEvent[]): readonly SessionAction[] {
  return walkActions(events).actions;
}
