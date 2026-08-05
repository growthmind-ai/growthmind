import { describe, expect, test } from "bun:test";

import {
  DESCRIBE_MAX_CLASSES,
  DESCRIBE_TRUNCATION_MARKER,
  DESCRIBE_VALUE_MAX_LENGTH,
  describeElement,
} from "../../src/replay/describe";
import { indexNodes, resolveIdentity, unknownIdentity } from "../../src/replay/nodes";
import type { ElementIdentity } from "../../src/replay/types";
import {
  API_KEY_NODE_ID,
  SUBMIT_NODE_ID,
  documentNode,
  element,
  settingsSnapshot,
  snapshotEvent,
} from "./fixtures";

function identityOf(node: ReturnType<typeof element>, nodeId: number): ElementIdentity {
  return resolveIdentity(indexNodes([snapshotEvent(0, documentNode([node]))]), nodeId);
}

describe("describeElement", () => {
  test("should describe a button by tag, class and id", () => {
    const index = indexNodes([settingsSnapshot()]);

    expect(describeElement(resolveIdentity(index, SUBMIT_NODE_ID))).toBe("button.gm-submit#save");
  });

  test("should fall back to the name attribute when the element carries neither class nor id", () => {
    const index = indexNodes([settingsSnapshot()]);

    expect(describeElement(resolveIdentity(index, API_KEY_NODE_ID))).toBe("input[name=apiKey]");
  });

  test("should describe a link by its href when nothing more identifying is present", () => {
    expect(describeElement(identityOf(element(4, "A", { href: "/settings" }), 4))).toBe(
      "a[href=/settings]",
    );
  });

  test("should prefer data-testid over every other fallback attribute", () => {
    const node = element(4, "A", { href: "/settings", name: "nav", "data-testid": "nav-settings" });

    expect(describeElement(identityOf(node, 4))).toBe("a[data-testid=nav-settings]");
  });

  test("should not add an attribute suffix once a class or id has identified the element", () => {
    const node = element(4, "A", { href: "/settings", class: "gm-nav" });

    expect(describeElement(identityOf(node, 4))).toBe("a.gm-nav");
  });

  test("should describe a bare element by its tag alone rather than inventing identity", () => {
    expect(describeElement(identityOf(element(4, "SECTION"), 4))).toBe("section");
  });

  test("should not spill more than DESCRIBE_MAX_CLASSES classes into one line", () => {
    const node = element(4, "DIV", { class: "one two three four five" });

    expect(describeElement(identityOf(node, 4))).toBe("div.one.two.three");
    expect(DESCRIBE_MAX_CLASSES).toBe(3);
  });

  test("should truncate an over-long attribute value rather than emitting a paragraph", () => {
    const long = "/settings?".padEnd(DESCRIBE_VALUE_MAX_LENGTH * 2, "x");
    const described = describeElement(identityOf(element(4, "A", { href: long }), 4));

    expect(described.length).toBeLessThanOrEqual(
      "a[href=]".length + DESCRIBE_VALUE_MAX_LENGTH + DESCRIBE_TRUNCATION_MARKER.length,
    );
    expect(described.endsWith(`${DESCRIBE_TRUNCATION_MARKER}]`)).toBe(true);
  });

  test("should collapse whitespace inside an attribute value so one action stays one line", () => {
    const node = element(4, "BUTTON", { "aria-label": " Save   your\n key " });

    expect(describeElement(identityOf(node, 4))).toBe("button[aria-label=Save your key]");
  });

  test("should mark an unresolvable node rather than describing a tag it never saw", () => {
    expect(describeElement(unknownIdentity(4242))).toBe("#unknown(4242)");
  });
});
