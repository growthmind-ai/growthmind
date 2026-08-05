import type { RrwebEvent } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  DEAD_CLICK_WINDOW_MS,
  RAGE_CLICK_MIN_CLICKS,
  RAGE_CLICK_WINDOW_MS,
  SCROLL_BACK_MIN_PX,
  WAIT_THRESHOLD_MS,
  toActions,
} from "../../src/replay/actions";
import { UNKNOWN_TAG_NAME } from "../../src/replay/nodes";
import type { SessionAction, SessionActionKind } from "../../src/replay/types";
import {
  API_KEY_NODE_ID,
  BARE_DIV_NODE_ID,
  BILLING_PAGE,
  DEEP_BUTTON_NODE_ID,
  DEEP_DIV_NODE_ID,
  ICON_BUTTON_NODE_ID,
  ICON_PATH_NODE_ID,
  LATE_NODE_ID,
  LINK_NODE_ID,
  LINK_TEXT_NODE_ID,
  SCROLL_NODE_ID,
  SETTINGS_PAGE,
  SUBMIT_NODE_ID,
  SUBMIT_TEXT_NODE_ID,
  blurEvent,
  clickEvent,
  controlsSnapshot,
  documentNode,
  doubleClickEvent,
  element,
  focusEvent,
  inputEvent,
  metaEvent,
  mouseMoveEvent,
  mutationEvent,
  scrollEvent,
  settingsSnapshot,
  snapshotEvent,
} from "./fixtures";

const kindsOf = (actions: readonly SessionAction[]): readonly SessionActionKind[] =>
  actions.map((action) => action.kind);

function only<K extends SessionActionKind>(
  actions: readonly SessionAction[],
  kind: K,
): readonly Extract<SessionAction, { kind: K }>[] {
  return actions.filter(
    (action): action is Extract<SessionAction, { kind: K }> => action.kind === kind,
  );
}

describe("toActions — a boring session", () => {
  test("should return no actions at all for an empty event list", () => {
    expect(toActions([])).toEqual([]);
  });

  test("should produce a page and an ended action for a session that only loaded a page", () => {
    const actions = toActions([metaEvent(0, SETTINGS_PAGE), settingsSnapshot(10)]);

    expect(actions).toEqual([
      { kind: "page", atMs: 0, href: SETTINGS_PAGE },
      { kind: "ended", atMs: 10 },
    ]);
  });

  test("should not invent an action for a session of mouse movement alone", () => {
    expect(toActions([mouseMoveEvent(0), mouseMoveEvent(500)])).toEqual([
      { kind: "ended", atMs: 500 },
    ]);
  });

  test("should not repeat a page action when the href has not changed", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      metaEvent(100, SETTINGS_PAGE),
      metaEvent(200, BILLING_PAGE),
    ]);

    expect(only(actions, "page")).toEqual([
      { kind: "page", atMs: 0, href: SETTINGS_PAGE },
      { kind: "page", atMs: 200, href: BILLING_PAGE },
    ]);
  });
});

describe("toActions — clicks", () => {
  test("should collapse three fast clicks on one node into one rage_click and not three clicks", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      clickEvent(1_200, SUBMIT_NODE_ID),
      clickEvent(1_400, SUBMIT_NODE_ID),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "rage_click", "ended"]);
    expect(only(actions, "rage_click")[0]).toEqual({
      kind: "rage_click",
      atMs: 1_000,
      element: expect.objectContaining({ tagName: "button" }),
      clicks: RAGE_CLICK_MIN_CLICKS,
      spanMs: 400,
    });
  });

  test("should not collapse three clicks spread wider than RAGE_CLICK_WINDOW_MS", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      clickEvent(1_000 + RAGE_CLICK_WINDOW_MS + 1, SUBMIT_NODE_ID),
      clickEvent(1_000 + RAGE_CLICK_WINDOW_MS * 2 + 2, SUBMIT_NODE_ID),
    ]);

    expect(only(actions, "rage_click")).toEqual([]);
    expect(only(actions, "dead_click")).toHaveLength(3);
  });

  test("should not collapse three fast clicks landing on three different nodes", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      clickEvent(1_100, API_KEY_NODE_ID),
      clickEvent(1_200, SCROLL_NODE_ID),
    ]);

    expect(only(actions, "rage_click")).toEqual([]);
    expect(only(actions, "dead_click")).toHaveLength(3);
  });

  test("should not call a click dead when a mutation follows inside the window", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      mutationEvent(1_100),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "click", "ended"]);
  });

  test("should not call a click dead when the page answers at exactly DEAD_CLICK_WINDOW_MS", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      mutationEvent(1_000 + DEAD_CLICK_WINDOW_MS),
    ]);

    expect(only(actions, "dead_click")).toEqual([]);
    expect(only(actions, "click")).toHaveLength(1);
  });

  test("should call a click dead when no mutation follows it inside the window", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      mutationEvent(1_000 + DEAD_CLICK_WINDOW_MS + 1),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "dead_click", "ended"]);
  });

  test("should record a double click as its own action", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      doubleClickEvent(1_000, SUBMIT_NODE_ID),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "double_click", "ended"]);
  });
});

describe("toActions — fields", () => {
  test("should read a focus then a blur with no typing between as field_abandoned", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      focusEvent(1_000, API_KEY_NODE_ID),
      blurEvent(2_000, API_KEY_NODE_ID),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "field_abandoned", "ended"]);
    expect(only(actions, "field_abandoned")[0]?.element.tagName).toBe("input");
  });

  test("should not call a field abandoned when the person typed before blurring", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      focusEvent(1_000, API_KEY_NODE_ID),
      inputEvent(1_500, API_KEY_NODE_ID),
      blurEvent(2_000, API_KEY_NODE_ID),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "input", "ended"]);
  });

  test("should not call a blur on a button an abandoned field", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      focusEvent(1_000, SUBMIT_NODE_ID),
      blurEvent(2_000, SUBMIT_NODE_ID),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "ended"]);
  });

  test("should count the second focus on the same field as a refocus", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      focusEvent(1_000, API_KEY_NODE_ID),
      inputEvent(1_100, API_KEY_NODE_ID),
      blurEvent(1_200, API_KEY_NODE_ID),
      focusEvent(2_000, API_KEY_NODE_ID),
      inputEvent(2_100, API_KEY_NODE_ID),
      blurEvent(2_200, API_KEY_NODE_ID),
      focusEvent(3_000, API_KEY_NODE_ID),
    ]);

    expect(only(actions, "field_refocus").map((action) => action.focusCount)).toEqual([2, 3]);
  });

  test("should not call the first focus of the session a refocus", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      focusEvent(1_000, API_KEY_NODE_ID),
      inputEvent(1_100, API_KEY_NODE_ID),
    ]);

    expect(only(actions, "field_refocus")).toEqual([]);
  });

  test("should record typing as presence once, never once per keystroke", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      focusEvent(1_000, API_KEY_NODE_ID),
      inputEvent(1_100, API_KEY_NODE_ID),
      inputEvent(1_200, API_KEY_NODE_ID),
      inputEvent(1_300, API_KEY_NODE_ID),
    ]);

    expect(only(actions, "input")).toHaveLength(1);
    expect(only(actions, "input")[0]?.atMs).toBe(1_100);
  });

  test("should record typing again once the person moved to another field", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      inputEvent(1_100, API_KEY_NODE_ID),
      inputEvent(1_200, SUBMIT_NODE_ID),
      inputEvent(1_300, API_KEY_NODE_ID),
    ]);

    expect(only(actions, "input")).toHaveLength(3);
  });
});

describe("toActions — scrolling", () => {
  test("should read a scroll down then up on one node as scroll_back", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      scrollEvent(1_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(1_200, SCROLL_NODE_ID, 0, 400),
      scrollEvent(1_400, SCROLL_NODE_ID, 0, 100),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "scroll_back", "ended"]);
    expect(only(actions, "scroll_back")[0]?.atMs).toBe(1_400);
  });

  test("should not read continued downward scrolling as scroll_back", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      scrollEvent(1_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(1_200, SCROLL_NODE_ID, 0, 400),
      scrollEvent(1_400, SCROLL_NODE_ID, 0, 900),
    ]);

    expect(only(actions, "scroll_back")).toEqual([]);
  });

  test("should not read jitter below SCROLL_BACK_MIN_PX as a decision to go back", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      scrollEvent(1_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(1_200, SCROLL_NODE_ID, 0, 400),
      scrollEvent(1_400, SCROLL_NODE_ID, 0, 400 - (SCROLL_BACK_MIN_PX - 1)),
    ]);

    expect(only(actions, "scroll_back")).toEqual([]);
  });

  test("should not carry one node's scroll direction onto another node", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      scrollEvent(1_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(1_100, SCROLL_NODE_ID, 0, 400),
      scrollEvent(1_200, SUBMIT_NODE_ID, 0, 0),
      scrollEvent(1_300, SUBMIT_NODE_ID, 0, -400),
      scrollEvent(1_400, SCROLL_NODE_ID, 0, 800),
      scrollEvent(1_500, SUBMIT_NODE_ID, 0, -800),
    ]);

    expect(only(actions, "scroll_back")).toEqual([]);
  });

  test("should attribute a reversal to the node that reversed", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      scrollEvent(1_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(1_100, SCROLL_NODE_ID, 0, 400),
      scrollEvent(1_200, SUBMIT_NODE_ID, 0, 0),
      scrollEvent(1_300, SUBMIT_NODE_ID, 0, 400),
      scrollEvent(1_400, SUBMIT_NODE_ID, 0, 0),
    ]);

    expect(only(actions, "scroll_back")).toHaveLength(1);
    expect(only(actions, "scroll_back")[0]?.element.nodeId).toBe(SUBMIT_NODE_ID);
  });

  test("should read a horizontal reversal on a carousel, not only a vertical one", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      scrollEvent(1_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(1_100, SCROLL_NODE_ID, 600, 0),
      scrollEvent(1_200, SCROLL_NODE_ID, 100, 0),
    ]);

    expect(only(actions, "scroll_back")).toHaveLength(1);
  });
});

describe("toActions — time", () => {
  test("should record a gap larger than WAIT_THRESHOLD_MS as a wait carrying its duration", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(20_000, SUBMIT_NODE_ID),
      mutationEvent(20_050),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "wait", "click", "ended"]);
    expect(only(actions, "wait")[0]).toEqual({ kind: "wait", atMs: 0, durationMs: 20_000 });
  });

  test("should not record a wait for a gap of exactly WAIT_THRESHOLD_MS", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(0),
      clickEvent(WAIT_THRESHOLD_MS, SUBMIT_NODE_ID),
      mutationEvent(WAIT_THRESHOLD_MS + 50),
    ]);

    expect(only(actions, "wait")).toEqual([]);
  });

  test("should end the transcript at the last event's time so it always terminates", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      mutationEvent(1_050),
      mouseMoveEvent(4_000),
    ]);

    expect(actions.at(-1)).toEqual({ kind: "ended", atMs: 4_000 });
  });

  test("should measure every action from the first event, not from the first click", () => {
    const actions = toActions([
      metaEvent(2_000, SETTINGS_PAGE),
      settingsSnapshot(2_010),
      clickEvent(3_000, SUBMIT_NODE_ID),
      mutationEvent(3_050),
    ]);

    expect(only(actions, "click")[0]?.atMs).toBe(1_000);
  });

  test("should start the clock at the first action, however long the recorder ran before it", () => {
    const idleMs = 4_673_000;
    const actions = toActions([
      mouseMoveEvent(0),
      mouseMoveEvent(idleMs - 1_000),
      metaEvent(idleMs, SETTINGS_PAGE),
      settingsSnapshot(idleMs + 10),
      clickEvent(idleMs + 1_000, SUBMIT_NODE_ID),
      mutationEvent(idleMs + 1_050),
    ]);

    expect(actions[0]).toEqual({ kind: "page", atMs: 0, href: SETTINGS_PAGE });
    expect(only(actions, "click")[0]?.atMs).toBe(1_000);
    expect(actions.at(-1)).toEqual({ kind: "ended", atMs: 1_050 });
  });

  test("should not shift the clock off zero when a recording produced no action at all", () => {
    expect(toActions([mouseMoveEvent(0), mouseMoveEvent(500)])).toEqual([
      { kind: "ended", atMs: 500 },
    ]);
  });
});

describe("toActions — element identity", () => {
  test("should resolve a node id that only a later mutation added", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      mutationEvent(500, [element(LATE_NODE_ID, "A", { href: "/billing" })]),
      clickEvent(1_000, LATE_NODE_ID),
      mutationEvent(1_050),
    ]);

    expect(only(actions, "click")[0]?.element).toEqual({
      nodeId: LATE_NODE_ID,
      tagName: "a",
      classes: [],
      attributes: { href: "/billing" },
    });
  });

  test("should degrade a node id the recording never described rather than throwing", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      clickEvent(1_000, 4_242),
      mutationEvent(1_050),
    ]);

    expect(only(actions, "click")[0]?.element.tagName).toBe(UNKNOWN_TAG_NAME);
  });

  test("should read the button a masked text node sits inside, never the text node itself", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_TEXT_NODE_ID),
      mutationEvent(1_050),
    ]);

    expect(only(actions, "click")[0]?.element.nodeId).toBe(SUBMIT_NODE_ID);
    expect(only(actions, "click")[0]?.element.tagName).toBe("button");
  });
});

describe("toActions — the DOM a click actually happened in", () => {
  const REUSED_NODE_ID = 21;

  function scriptThenButton(): readonly RrwebEvent[] {
    return [
      metaEvent(0, SETTINGS_PAGE),
      snapshotEvent(
        10,
        documentNode([
          element(2, "HTML", {}, [
            element(3, "HEAD", {}, [
              element(REUSED_NODE_ID, "SCRIPT", { type: "text/javascript" }),
            ]),
          ]),
        ]),
      ),
      snapshotEvent(
        5_000,
        documentNode([
          element(2, "HTML", {}, [
            element(3, "BODY", {}, [element(REUSED_NODE_ID, "BUTTON", { class: "gm-pay" })]),
          ]),
        ]),
      ),
    ];
  }

  test("should resolve a click against the newest snapshot when two snapshots reuse one node id", () => {
    const actions = toActions([
      ...scriptThenButton(),
      clickEvent(6_000, REUSED_NODE_ID),
      mutationEvent(6_050),
    ]);

    expect(only(actions, "click")[0]?.element.tagName).toBe("button");
    expect(only(actions, "click")[0]?.element.classes).toEqual(["gm-pay"]);
  });

  test("should still resolve a click against the older snapshot while that snapshot is the live one", () => {
    const actions = toActions([
      ...scriptThenButton(),
      clickEvent(1_000, REUSED_NODE_ID),
      mutationEvent(1_050),
    ]);

    expect(only(actions, "click")[0]?.element.tagName).toBe("script");
  });

  test("should not resolve a click that happened before any snapshot against a later tree", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      clickEvent(1_000, SUBMIT_NODE_ID),
      mutationEvent(1_050),
      settingsSnapshot(5_000),
    ]);

    expect(only(actions, "click")[0]?.element.tagName).toBe(UNKNOWN_TAG_NAME);
  });
});

describe("toActions — the control a person meant to press", () => {
  test("should describe the button when the click landed on the path inside its icon", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      controlsSnapshot(10),
      clickEvent(1_000, ICON_PATH_NODE_ID),
      mutationEvent(1_050),
    ]);

    expect(only(actions, "click")[0]?.element.nodeId).toBe(ICON_BUTTON_NODE_ID);
    expect(only(actions, "click")[0]?.element.tagName).toBe("button");
  });

  test("should describe the anchor when the click landed on the text inside it", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      controlsSnapshot(10),
      clickEvent(1_000, LINK_TEXT_NODE_ID),
      mutationEvent(1_050),
    ]);

    expect(only(actions, "click")[0]?.element.nodeId).toBe(LINK_NODE_ID);
    expect(only(actions, "click")[0]?.element.tagName).toBe("a");
  });

  test("should describe the div itself when no control sits above it within the walk", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      controlsSnapshot(10),
      clickEvent(1_000, BARE_DIV_NODE_ID),
      mutationEvent(1_050),
      clickEvent(2_000, DEEP_DIV_NODE_ID),
      mutationEvent(2_050),
    ]);

    const clicked = only(actions, "click").map((action) => action.element.nodeId);
    expect(clicked).toEqual([BARE_DIV_NODE_ID, DEEP_DIV_NODE_ID]);
    expect(clicked).not.toContain(DEEP_BUTTON_NODE_ID);
  });

  test("should not call a click dead when the page answers the control the click resolved to", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      controlsSnapshot(10),
      clickEvent(1_000, ICON_PATH_NODE_ID),
      mutationEvent(1_100),
    ]);

    expect(kindsOf(actions)).toEqual(["page", "click", "ended"]);
    expect(only(actions, "dead_click")).toEqual([]);
    expect(only(actions, "click")[0]?.element.nodeId).toBe(ICON_BUTTON_NODE_ID);
  });

  test("should collapse hammering on one button reported as clicks on its icon and its label", () => {
    const actions = toActions([
      metaEvent(0, SETTINGS_PAGE),
      controlsSnapshot(10),
      clickEvent(1_000, ICON_PATH_NODE_ID),
      clickEvent(1_200, ICON_BUTTON_NODE_ID),
      clickEvent(1_400, ICON_PATH_NODE_ID),
    ]);

    expect(only(actions, "rage_click")).toHaveLength(1);
    expect(only(actions, "rage_click")[0]?.element.nodeId).toBe(ICON_BUTTON_NODE_ID);
  });
});
