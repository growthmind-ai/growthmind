import { describe, expect, test } from "bun:test";

import {
  MAX_ANCESTOR_WALK,
  MAX_INDEXED_NODES,
  UNKNOWN_TAG_NAME,
  indexDomSegments,
  isInteractive,
  isUnknownIdentity,
  resolveControlAt,
  resolveIdentity,
  resolveIdentityAt,
  segmentAt,
  unknownIdentity,
} from "../../src/replay/nodes";
import type { Node } from "./fixtures";
import {
  API_KEY_NODE_ID,
  BARE_DIV_NODE_ID,
  BASE_TS,
  DEEP_BUTTON_NODE_ID,
  DEEP_DIV_NODE_ID,
  ICON_BUTTON_NODE_ID,
  ICON_PATH_NODE_ID,
  LATE_NODE_ID,
  LINK_NODE_ID,
  LINK_TEXT_NODE_ID,
  SUBMIT_NODE_ID,
  SUBMIT_TEXT_NODE_ID,
  controlsSnapshot,
  documentNode,
  element,
  lastSegmentIndex,
  maskedText,
  mutationEvent,
  settingsSnapshot,
  snapshotEvent,
} from "./fixtures";

describe("indexDomSegments", () => {
  test("should index an element by node id with its tag, classes, id and attributes", () => {
    const index = lastSegmentIndex([settingsSnapshot()]);
    const submit = index.get(SUBMIT_NODE_ID);

    expect(submit).toEqual({
      nodeId: SUBMIT_NODE_ID,
      tagName: "button",
      id: "save",
      classes: ["gm-submit"],
      attributes: { class: "gm-submit", id: "save" },
    });
  });

  test("should carry role and data-testid onto the identity when the element declares them", () => {
    const index = lastSegmentIndex([
      snapshotEvent(
        0,
        documentNode([element(4, "DIV", { role: "dialog", "data-testid": "connect-modal" })]),
      ),
    ]);

    expect(index.get(4)).toEqual({
      nodeId: 4,
      tagName: "div",
      classes: [],
      role: "dialog",
      testId: "connect-modal",
      attributes: { role: "dialog", "data-testid": "connect-modal" },
    });
  });

  test("should split the class attribute on whitespace and keep the authored order", () => {
    const index = lastSegmentIndex([
      snapshotEvent(0, documentNode([element(4, "DIV", { class: "  zeta  alpha\nmid " })])),
    ]);

    expect(index.get(4)?.classes).toEqual(["zeta", "alpha", "mid"]);
  });

  test("should not give a masked text node an identity", () => {
    const index = lastSegmentIndex([settingsSnapshot()]);

    expect(index.has(SUBMIT_TEXT_NODE_ID)).toBe(false);
    expect(index.get(SUBMIT_TEXT_NODE_ID)).toBeUndefined();
  });

  test("should not index an element with no tag name rather than inventing one", () => {
    const index = lastSegmentIndex([
      snapshotEvent(0, documentNode([{ type: 2, id: 4, attributes: {}, childNodes: [] }])),
    ]);

    expect(index.size).toBe(0);
  });

  test("should resolve a node id that only a later mutation added", () => {
    const late = element(LATE_NODE_ID, "A", { href: "/settings", class: "gm-link" });
    const index = lastSegmentIndex([settingsSnapshot(), mutationEvent(500, [late])]);

    expect(index.get(LATE_NODE_ID)).toEqual({
      nodeId: LATE_NODE_ID,
      tagName: "a",
      classes: ["gm-link"],
      attributes: { href: "/settings", class: "gm-link" },
    });
  });

  test("should index the children of a subtree a mutation added", () => {
    const subtree = element(LATE_NODE_ID, "FORM", {}, [
      element(LATE_NODE_ID + 1, "INPUT", { name: "seat" }),
      maskedText(LATE_NODE_ID + 2),
    ]);

    const index = lastSegmentIndex([settingsSnapshot(), mutationEvent(500, [subtree])]);

    expect(index.get(LATE_NODE_ID + 1)?.tagName).toBe("input");
    expect(index.has(LATE_NODE_ID + 2)).toBe(false);
  });

  test("should read a reused node id from the newest snapshot's tree, never an older one", () => {
    const index = lastSegmentIndex([
      settingsSnapshot(),
      snapshotEvent(900, documentNode([element(SUBMIT_NODE_ID, "A", { href: "/billing" })])),
    ]);

    expect(index.get(SUBMIT_NODE_ID)?.tagName).toBe("a");
  });

  test("should open one segment per full snapshot rather than merging every DOM into one", () => {
    const segments = indexDomSegments([
      settingsSnapshot(),
      snapshotEvent(900, documentNode([element(SUBMIT_NODE_ID, "A", { href: "/billing" })])),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0].fromTsMs).toBe(BASE_TS);
    expect(segments[1].fromTsMs).toBe(BASE_TS + 900);
    expect(segments[0].index.get(SUBMIT_NODE_ID)?.tagName).toBe("button");
    expect(segments[1].index.get(SUBMIT_NODE_ID)?.tagName).toBe("a");
  });

  test("should attach a mutation to the segment it happened in, not to a later one", () => {
    const late = element(LATE_NODE_ID, "A", { href: "/settings" });
    const segments = indexDomSegments([
      settingsSnapshot(),
      mutationEvent(500, [late]),
      snapshotEvent(900, documentNode([element(SUBMIT_NODE_ID, "A", { href: "/billing" })])),
    ]);

    expect(segments[0].index.has(LATE_NODE_ID)).toBe(true);
    expect(segments[1].index.has(LATE_NODE_ID)).toBe(false);
  });

  test("should not open a segment for a mutation that arrived before any snapshot", () => {
    const late = element(LATE_NODE_ID, "A", { href: "/settings" });

    expect(indexDomSegments([mutationEvent(5, [late])])).toEqual([]);
  });

  test("should keep the parent of a masked text node so a click on it can find its control", () => {
    const segments = indexDomSegments([settingsSnapshot()]);

    expect(segments[0].parents.get(SUBMIT_TEXT_NODE_ID)).toBe(SUBMIT_NODE_ID);
    expect(segments[0].index.has(SUBMIT_TEXT_NODE_ID)).toBe(false);
  });

  test("should not throw or loop forever on a child list that points back at its parent", () => {
    const cyclic: Node = { type: 2, id: 4, tagName: "DIV", attributes: {}, childNodes: [] };
    (cyclic["childNodes"] as Node[]).push(cyclic);

    const index = lastSegmentIndex([snapshotEvent(0, documentNode([cyclic]))]);

    expect(index.size).toBe(1);
    expect(MAX_INDEXED_NODES).toBeGreaterThan(0);
  });

  test("should index nothing when the recording carries no snapshot at all", () => {
    expect(lastSegmentIndex([]).size).toBe(0);
    expect(lastSegmentIndex([mutationEvent(10)]).size).toBe(0);
  });
});

describe("segmentAt", () => {
  test("should return no segment for a moment before the first snapshot", () => {
    const segments = indexDomSegments([settingsSnapshot(900)]);

    expect(segmentAt(segments, BASE_TS)).toBeNull();
    expect(segmentAt(segments, BASE_TS + 900)).not.toBeNull();
  });

  test("should return the newest snapshot at or before the moment asked about", () => {
    const segments = indexDomSegments([
      settingsSnapshot(),
      snapshotEvent(900, documentNode([element(SUBMIT_NODE_ID, "A", { href: "/billing" })])),
    ]);

    expect(segmentAt(segments, BASE_TS + 899)?.fromTsMs).toBe(BASE_TS);
    expect(segmentAt(segments, BASE_TS + 5_000)?.fromTsMs).toBe(BASE_TS + 900);
  });
});

describe("resolveIdentity", () => {
  test("should resolve a known node id to its indexed identity", () => {
    const index = lastSegmentIndex([settingsSnapshot()]);
    const field = resolveIdentity(index, API_KEY_NODE_ID);

    expect(field.tagName).toBe("input");
    expect(isUnknownIdentity(field)).toBe(false);
  });

  test("should degrade an unindexed node id to a marked unknown rather than throwing", () => {
    const index = lastSegmentIndex([settingsSnapshot()]);
    const missing = resolveIdentity(index, 4242);

    expect(missing).toEqual(unknownIdentity(4242));
    expect(missing.tagName).toBe(UNKNOWN_TAG_NAME);
    expect(isUnknownIdentity(missing)).toBe(true);
  });
});

describe("resolveIdentityAt", () => {
  test("should resolve a node id against the tree that was live at that moment", () => {
    const segments = indexDomSegments([
      settingsSnapshot(),
      snapshotEvent(900, documentNode([element(SUBMIT_NODE_ID, "A", { href: "/billing" })])),
    ]);

    expect(resolveIdentityAt(segments, SUBMIT_NODE_ID, BASE_TS + 500).tagName).toBe("button");
    expect(resolveIdentityAt(segments, SUBMIT_NODE_ID, BASE_TS + 1_500).tagName).toBe("a");
  });

  test("should not resolve a moment before the first snapshot against a later tree", () => {
    const segments = indexDomSegments([settingsSnapshot(900)]);

    expect(isUnknownIdentity(resolveIdentityAt(segments, SUBMIT_NODE_ID, BASE_TS))).toBe(true);
  });
});

describe("isInteractive", () => {
  test("should not call a plain div interactive, whatever it is styled to look like", () => {
    const index = lastSegmentIndex([controlsSnapshot()]);
    const bare = resolveIdentity(index, BARE_DIV_NODE_ID);

    expect(isInteractive(bare)).toBe(false);
    expect(isInteractive(unknownIdentity(4242))).toBe(false);
  });

  test("should call a control interactive by tag, by role or by a submit type", () => {
    const index = lastSegmentIndex([
      controlsSnapshot(),
      mutationEvent(10, [
        element(70, "DIV", { role: "button" }),
        element(71, "DIV", { role: "presentation" }),
        element(72, "DIV", { type: "submit" }),
      ]),
    ]);

    expect(isInteractive(resolveIdentity(index, ICON_BUTTON_NODE_ID))).toBe(true);
    expect(isInteractive(resolveIdentity(index, LINK_NODE_ID))).toBe(true);
    expect(isInteractive(resolveIdentity(index, 70))).toBe(true);
    expect(isInteractive(resolveIdentity(index, 71))).toBe(false);
    expect(isInteractive(resolveIdentity(index, 72))).toBe(true);
  });
});

describe("resolveControlAt", () => {
  test("should walk up from an icon to the button that contains it", () => {
    const segments = indexDomSegments([controlsSnapshot()]);
    const control = resolveControlAt(segments, ICON_PATH_NODE_ID, BASE_TS);

    expect(control.nodeId).toBe(ICON_BUTTON_NODE_ID);
    expect(control.tagName).toBe("button");
  });

  test("should walk up from a masked text node to the anchor that contains it", () => {
    const segments = indexDomSegments([controlsSnapshot()]);
    const control = resolveControlAt(segments, LINK_TEXT_NODE_ID, BASE_TS);

    expect(control.nodeId).toBe(LINK_NODE_ID);
    expect(control.tagName).toBe("a");
  });

  test("should give up rather than invent a control when none sits within MAX_ANCESTOR_WALK", () => {
    const segments = indexDomSegments([controlsSnapshot()]);

    expect(resolveControlAt(segments, BARE_DIV_NODE_ID, BASE_TS).nodeId).toBe(BARE_DIV_NODE_ID);
    expect(resolveControlAt(segments, DEEP_DIV_NODE_ID, BASE_TS).nodeId).toBe(DEEP_DIV_NODE_ID);
    expect(resolveControlAt(segments, DEEP_DIV_NODE_ID, BASE_TS).nodeId).not.toBe(
      DEEP_BUTTON_NODE_ID,
    );
    expect(MAX_ANCESTOR_WALK).toBeGreaterThan(0);
  });

  test("should not walk into a tree that did not exist yet at that moment", () => {
    const segments = indexDomSegments([controlsSnapshot(900)]);

    expect(isUnknownIdentity(resolveControlAt(segments, ICON_PATH_NODE_ID, BASE_TS))).toBe(true);
  });
});

describe("isUnknownIdentity", () => {
  test("should not call a real element unknown just because it carries no id or class", () => {
    const index = lastSegmentIndex([snapshotEvent(0, documentNode([element(4, "SPAN")]))]);

    expect(isUnknownIdentity(resolveIdentity(index, 4))).toBe(false);
    expect(isUnknownIdentity(unknownIdentity(4))).toBe(true);
  });
});
