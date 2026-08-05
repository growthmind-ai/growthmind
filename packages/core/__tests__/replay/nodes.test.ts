import { describe, expect, test } from "bun:test";

import {
  MAX_INDEXED_NODES,
  UNKNOWN_TAG_NAME,
  indexNodes,
  isUnknownIdentity,
  resolveIdentity,
  unknownIdentity,
} from "../../src/replay/nodes";
import type { Node } from "./fixtures";
import {
  API_KEY_NODE_ID,
  LATE_NODE_ID,
  SUBMIT_NODE_ID,
  documentNode,
  element,
  maskedText,
  mutationEvent,
  settingsSnapshot,
  snapshotEvent,
} from "./fixtures";

describe("indexNodes", () => {
  test("should index an element by node id with its tag, classes, id and attributes", () => {
    const index = indexNodes([settingsSnapshot()]);
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
    const index = indexNodes([
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
    const index = indexNodes([
      snapshotEvent(0, documentNode([element(4, "DIV", { class: "  zeta  alpha\nmid " })])),
    ]);

    expect(index.get(4)?.classes).toEqual(["zeta", "alpha", "mid"]);
  });

  test("should not give a masked text node an identity", () => {
    const index = indexNodes([settingsSnapshot()]);

    expect(index.has(31)).toBe(false);
    expect(index.get(31)).toBeUndefined();
  });

  test("should not index an element with no tag name rather than inventing one", () => {
    const index = indexNodes([
      snapshotEvent(0, documentNode([{ type: 2, id: 4, attributes: {}, childNodes: [] }])),
    ]);

    expect(index.size).toBe(0);
  });

  test("should resolve a node id that only a later mutation added", () => {
    const late = element(LATE_NODE_ID, "A", { href: "/settings", class: "gm-link" });
    const index = indexNodes([settingsSnapshot(), mutationEvent(500, [late])]);

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

    const index = indexNodes([settingsSnapshot(), mutationEvent(500, [subtree])]);

    expect(index.get(LATE_NODE_ID + 1)?.tagName).toBe("input");
    expect(index.has(LATE_NODE_ID + 2)).toBe(false);
  });

  test("should let a later full snapshot replace the identity of a reused node id", () => {
    const index = indexNodes([
      settingsSnapshot(),
      snapshotEvent(900, documentNode([element(SUBMIT_NODE_ID, "A", { href: "/billing" })])),
    ]);

    expect(index.get(SUBMIT_NODE_ID)?.tagName).toBe("a");
  });

  test("should not throw or loop forever on a child list that points back at its parent", () => {
    const cyclic: Node = { type: 2, id: 4, tagName: "DIV", attributes: {}, childNodes: [] };
    (cyclic["childNodes"] as Node[]).push(cyclic);

    const index = indexNodes([snapshotEvent(0, documentNode([cyclic]))]);

    expect(index.size).toBe(1);
    expect(MAX_INDEXED_NODES).toBeGreaterThan(0);
  });

  test("should index nothing when the recording carries no snapshot at all", () => {
    expect(indexNodes([]).size).toBe(0);
    expect(indexNodes([mutationEvent(10)]).size).toBe(0);
  });
});

describe("resolveIdentity", () => {
  test("should resolve a known node id to its indexed identity", () => {
    const index = indexNodes([settingsSnapshot()]);
    const field = resolveIdentity(index, API_KEY_NODE_ID);

    expect(field.tagName).toBe("input");
    expect(isUnknownIdentity(field)).toBe(false);
  });

  test("should degrade an unindexed node id to a marked unknown rather than throwing", () => {
    const index = indexNodes([settingsSnapshot()]);
    const missing = resolveIdentity(index, 4242);

    expect(missing).toEqual(unknownIdentity(4242));
    expect(missing.tagName).toBe(UNKNOWN_TAG_NAME);
    expect(isUnknownIdentity(missing)).toBe(true);
  });
});

describe("isUnknownIdentity", () => {
  test("should not call a real element unknown just because it carries no id or class", () => {
    const index = indexNodes([snapshotEvent(0, documentNode([element(4, "SPAN")]))]);

    expect(isUnknownIdentity(resolveIdentity(index, 4))).toBe(false);
    expect(isUnknownIdentity(unknownIdentity(4))).toBe(true);
  });
});
