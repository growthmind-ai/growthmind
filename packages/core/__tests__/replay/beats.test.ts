import { describe, expect, test } from "bun:test";

import type { TranscriptBeatKind } from "@growthmind/shared";

import { beatKindOf, beatsFromActions, firstCitedBeat } from "../../src/replay/beats";
import { describeElement } from "../../src/replay/describe";
import type {
  PersistedElement,
  PersistedSessionAction,
} from "../../src/replay/persisted-transcript";
import type { ElementIdentity, SessionActionKind } from "../../src/replay/types";

function element(
  nodeId: number,
  tag: string,
  extra: Partial<Omit<PersistedElement, "nodeId" | "tag">> = {},
): PersistedElement {
  return { nodeId, tag, classes: [], ...extra };
}

// The same conversion beatsFromActions must perform internally before calling
// describeElement — asserted against directly so this fixture never drifts from
// production's own PersistedElement -> ElementIdentity mapping (Decision 4).
function identityOf(el: PersistedElement): ElementIdentity {
  return {
    nodeId: el.nodeId,
    tagName: el.tag,
    classes: el.classes,
    attributes: {},
    ...(el.id === undefined ? {} : { id: el.id }),
    ...(el.role === undefined ? {} : { role: el.role }),
    ...(el.testId === undefined ? {} : { testId: el.testId }),
  };
}

const SUBMIT_ELEMENT = element(21, "button", { classes: ["gm-submit"], id: "save" });
const FIELD_ELEMENT = element(22, "input", { classes: [] });

// Mirrors CauseBeatEvidence (packages/core/src/cause/types.ts, not yet built — ADD
// Decision 4/6) for annotation purposes only, so this file's own callbacks typecheck
// independently of that not-yet-existing module.
type ExpectedCauseBeat = {
  readonly index: number;
  readonly kind: TranscriptBeatKind;
  readonly text: string;
  readonly notable: boolean;
  readonly attempt: number | null;
};

const ALL_KIND_MAPPING: readonly (readonly [SessionActionKind, TranscriptBeatKind])[] = [
  ["page", "navigate"],
  ["click", "click"],
  ["double_click", "click"],
  ["rage_click", "click"],
  ["dead_click", "click"],
  ["input", "input"],
  ["field_refocus", "input"],
  ["field_abandoned", "input"],
  ["scroll_back", "idle"],
  ["wait", "idle"],
  ["ended", "exit"],
];

describe("beatKindOf", () => {
  test("should map every SessionActionKind to a TranscriptBeatKind exhaustively", () => {
    expect(ALL_KIND_MAPPING).toHaveLength(11);
    expect(new Set(ALL_KIND_MAPPING.map(([kind]) => kind)).size).toBe(11);

    for (const [kind, expectedBeatKind] of ALL_KIND_MAPPING) {
      expect(beatKindOf(kind)).toBe(expectedBeatKind);
    }
  });
});

function mixedKindActions(): readonly PersistedSessionAction[] {
  return [
    { kind: "page", atMs: 0, href: "/settings" },
    { kind: "click", atMs: 1000, element: SUBMIT_ELEMENT },
    { kind: "double_click", atMs: 2000, element: SUBMIT_ELEMENT },
    { kind: "rage_click", atMs: 3000, element: SUBMIT_ELEMENT, clicks: 4, spanMs: 500 },
    { kind: "dead_click", atMs: 4000, element: SUBMIT_ELEMENT },
    { kind: "input", atMs: 5000, element: FIELD_ELEMENT },
    { kind: "field_refocus", atMs: 6000, element: FIELD_ELEMENT, focusCount: 2 },
    { kind: "field_abandoned", atMs: 7000, element: FIELD_ELEMENT },
    { kind: "scroll_back", atMs: 8000, element: FIELD_ELEMENT },
    { kind: "wait", atMs: 9000, durationMs: 12_000 },
    { kind: "ended", atMs: 21_000 },
  ];
}

describe("beatsFromActions", () => {
  test("should reuse describeElement for beat text on every element-bearing action kind", () => {
    const elementBearingActions: readonly PersistedSessionAction[] = [
      { kind: "click", atMs: 0, element: SUBMIT_ELEMENT },
      { kind: "double_click", atMs: 1, element: SUBMIT_ELEMENT },
      { kind: "dead_click", atMs: 2, element: SUBMIT_ELEMENT },
      { kind: "input", atMs: 3, element: FIELD_ELEMENT },
      { kind: "field_refocus", atMs: 4, element: FIELD_ELEMENT, focusCount: 2 },
      { kind: "field_abandoned", atMs: 5, element: FIELD_ELEMENT },
      { kind: "scroll_back", atMs: 6, element: FIELD_ELEMENT },
    ];
    const expectedElements = [
      SUBMIT_ELEMENT,
      SUBMIT_ELEMENT,
      SUBMIT_ELEMENT,
      FIELD_ELEMENT,
      FIELD_ELEMENT,
      FIELD_ELEMENT,
      FIELD_ELEMENT,
    ];

    const beats = beatsFromActions(elementBearingActions);

    expect(beats).toHaveLength(elementBearingActions.length);
    beats.forEach((beat: ExpectedCauseBeat, index: number) => {
      const expectedElement = expectedElements[index];
      if (expectedElement === undefined) throw new Error("fixture length mismatch");
      expect(beat.text).toBe(describeElement(identityOf(expectedElement)));
    });
  });

  test("should mark rage_click, dead_click, field_refocus, field_abandoned as notable and everything else as not notable", () => {
    const actions = mixedKindActions();
    const notableKinds = new Set(["rage_click", "dead_click", "field_refocus", "field_abandoned"]);

    const beats = beatsFromActions(actions);

    expect(beats).toHaveLength(actions.length);
    beats.forEach((beat: ExpectedCauseBeat, index: number) => {
      const action = actions[index];
      if (action === undefined) throw new Error("fixture length mismatch");
      expect(beat.notable).toBe(notableKinds.has(action.kind));
    });
  });

  test("should carry rage_click.clicks and field_refocus.focusCount into attempt, and null elsewhere", () => {
    const actions = mixedKindActions();
    const attemptCarryingKinds = new Set(["rage_click", "field_refocus"]);

    const beats = beatsFromActions(actions);

    expect(beats).toHaveLength(actions.length);
    beats.forEach((beat: ExpectedCauseBeat, index: number) => {
      const action = actions[index];
      if (action === undefined) throw new Error("fixture length mismatch");

      if (action.kind === "rage_click") {
        expect(beat.attempt).toBe(action.clicks ?? null);
      } else if (action.kind === "field_refocus") {
        expect(beat.attempt).toBe(action.focusCount ?? null);
      } else {
        expect(attemptCarryingKinds.has(action.kind)).toBe(false);
        expect(beat.attempt).toBeNull();
      }
    });
  });

  test("should index beats zero-based in input order, never reordering by kind", () => {
    const actions: readonly PersistedSessionAction[] = [
      { kind: "click", atMs: 500, element: SUBMIT_ELEMENT },
      { kind: "page", atMs: 100, href: "/a" },
      { kind: "ended", atMs: 900 },
    ];

    const beats = beatsFromActions(actions);

    expect(beats.map((beat: ExpectedCauseBeat) => beat.index)).toEqual([0, 1, 2]);
    expect(beats.map((beat: ExpectedCauseBeat) => beat.kind)).toEqual([
      "click",
      "navigate",
      "exit",
    ]);
  });
});

describe("firstCitedBeat", () => {
  test("should resolve a claim's citation to the beat at its first cited index", () => {
    const beats = beatsFromActions(mixedKindActions());

    expect(firstCitedBeat(beats, [3, 5])).toBe(beats[3]);
  });

  test("should return undefined for a claim citing no beats", () => {
    const beats = beatsFromActions(mixedKindActions());

    expect(firstCitedBeat(beats, [])).toBeUndefined();
  });

  test("should return undefined for a citation index outside the supplied beats", () => {
    const beats = beatsFromActions(mixedKindActions());

    expect(firstCitedBeat(beats, [beats.length])).toBeUndefined();
  });
});
