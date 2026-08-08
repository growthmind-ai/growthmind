import { describe, expect, test } from "bun:test";

import {
  DESCRIBE_ATTRIBUTE_PRECEDENCE,
  DESCRIBE_MAX_CLASSES,
  DESCRIBE_NAME_LABEL,
  DESCRIBE_SEMANTIC_PRECEDENCE,
  DESCRIBE_TRUNCATION_MARKER,
  DESCRIBE_VALUE_MAX_LENGTH,
  describeElement,
} from "../../src/replay/describe";
import { resolveIdentity, unknownIdentity } from "../../src/replay/nodes";
import type { ElementIdentity } from "../../src/replay/types";
import {
  API_KEY_NODE_ID,
  SIGN_IN_BUTTON_NODE_ID,
  SIGN_IN_EMAIL_ELEMENT_ID,
  SIGN_IN_EMAIL_NODE_ID,
  SUBMIT_NODE_ID,
  documentNode,
  element,
  lastSegmentIndex,
  settingsSnapshot,
  signInSnapshot,
  snapshotEvent,
} from "./fixtures";

function identityOf(node: ReturnType<typeof element>, nodeId: number): ElementIdentity {
  return resolveIdentity(lastSegmentIndex([snapshotEvent(0, documentNode([node]))]), nodeId);
}

describe("describeElement", () => {
  test("should describe a button by tag, class and id", () => {
    const index = lastSegmentIndex([settingsSnapshot()]);

    expect(describeElement(resolveIdentity(index, SUBMIT_NODE_ID))).toBe("button.gm-submit#save");
  });

  test("should fall back to the name attribute when the element carries neither class nor id", () => {
    const index = lastSegmentIndex([settingsSnapshot()]);

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

  test("should lead with the semantic descriptor even when a class also identifies the element", () => {
    const node = element(4, "A", { href: "/settings", class: "gm-nav" });

    expect(describeElement(identityOf(node, 4))).toBe("a[href=/settings].gm-nav");
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
    const long = `/settings/${"x".repeat(DESCRIBE_VALUE_MAX_LENGTH * 2)}/api-keys`;
    const described = describeElement(identityOf(element(4, "A", { href: long }), 4));

    expect(described.length).toBeLessThanOrEqual(
      "a[href=]".length + DESCRIBE_VALUE_MAX_LENGTH + DESCRIBE_TRUNCATION_MARKER.length,
    );
    expect(described.startsWith(`a[href=${DESCRIBE_TRUNCATION_MARKER}`)).toBe(true);
    expect(described.endsWith("/api-keys]")).toBe(true);
  });

  test("should render a link as its path, never as an origin every link on the site shares", () => {
    const origin = "https://app.growthmind-analytics.example.com";
    const keys = describeElement(
      identityOf(element(4, "A", { href: `${origin}/settings/keys` }), 4),
    );
    const billing = describeElement(
      identityOf(element(4, "A", { href: `${origin}/settings/billing` }), 4),
    );

    expect(keys).toBe("a[href=/settings/keys]");
    expect(billing).toBe("a[href=/settings/billing]");
    expect(keys).not.toBe(billing);
  });

  test("should keep the host when a link has no path to tell it apart by", () => {
    expect(
      describeElement(identityOf(element(4, "A", { href: "https://growthmind.ai/" }), 4)),
    ).toBe("a[href=growthmind.ai]");
    expect(describeElement(identityOf(element(4, "A", { href: "https://growthmind.ai" }), 4))).toBe(
      "a[href=growthmind.ai]",
    );
  });

  test("should collapse whitespace inside an id so one action stays one line", () => {
    const node = element(4, "BUTTON", { id: " save   your\n key " });

    expect(describeElement(identityOf(node, 4))).toBe("button#save your key");
  });

  test("should withhold an attribute value carrying an email address rather than store it (B-052)", () => {
    const node = element(4, "INPUT", { placeholder: "you@company.com" });

    expect(describeElement(identityOf(node, 4))).toBe("input");
  });

  test("should withhold a multi-word label on shape alone, not on detecting a name in it", () => {
    const node = element(4, "BUTTON", { "aria-label": "Delete invoice for Jane Cooper" });

    expect(describeElement(identityOf(node, 4))).toBe("button");
  });

  // B-052's residual, named rather than hidden: there is no name detector, so a single-word
  // value that happens to be a name passes the shape check and isCleanForDelivery both.
  test("should NOT withhold a single-word name — no name detector exists (B-052 residual)", () => {
    const node = element(4, "BUTTON", { "aria-label": "JaneCooper" });

    expect(describeElement(identityOf(node, 4))).toBe("button[aria-label=JaneCooper]");
  });

  test("should withhold a token-shaped value the delivery scan refuses", () => {
    const card = element(4, "A", { href: "/invoices/4111111111111111" });
    const credential = element(5, "A", { href: "/reset?token=sk-liveABCDEFGHIJKLMNOP" });

    expect(describeElement(identityOf(card, 4))).toBe("a");
    expect(describeElement(identityOf(credential, 5))).toBe("a");
  });

  test("should keep describing an element by the next attribute once a value is withheld", () => {
    const node = element(4, "BUTTON", { "aria-label": "Pay ada@acme.com", type: "submit" });

    expect(describeElement(identityOf(node, 4))).toBe("button[type=submit]");
  });

  test("should mark an unresolvable node rather than describing a tag it never saw", () => {
    expect(describeElement(unknownIdentity(4242))).toBe("#unknown(4242)");
  });
});

describe("describeElement — meaning ahead of a build tool's hash", () => {
  test("should name the field a person filled in rather than the hash class Mantine stamped on it", () => {
    const index = lastSegmentIndex([signInSnapshot()]);
    const described = describeElement(resolveIdentity(index, SIGN_IN_EMAIL_NODE_ID));

    expect(described).toBe(`input[label=Email]#${SIGN_IN_EMAIL_ELEMENT_ID}`);
    expect(described).not.toContain("m_8fb7ebe7");
  });

  test("should name the submit button by the words on it, not by its type and hash class", () => {
    const index = lastSegmentIndex([signInSnapshot()]);
    const described = describeElement(resolveIdentity(index, SIGN_IN_BUTTON_NODE_ID));

    expect(described).toBe("button[label=Sign in].m_77c9d27d");
    expect(described).not.toBe("button[type=submit].m_77c9d27d");
  });

  test("should keep two controls sharing one name tellable apart", () => {
    const first = element(4, "BUTTON", { "aria-label": "Copy", id: "copy-key" });
    const second = element(5, "BUTTON", { "aria-label": "Copy", id: "copy-secret" });
    const byClass = element(6, "BUTTON", { "aria-label": "Copy", class: "gm-row-two" });

    expect(describeElement(identityOf(first, 4))).toBe("button[aria-label=Copy]#copy-key");
    expect(describeElement(identityOf(second, 5))).toBe("button[aria-label=Copy]#copy-secret");
    expect(describeElement(identityOf(byClass, 6))).toBe("button[aria-label=Copy].gm-row-two");
  });

  test("should carry one handle after the name, not the whole class list back again", () => {
    const node = element(4, "BUTTON", {
      "aria-label": "Copy",
      class: "m_77c9d27d mantine-Button-root mantine-Button-label",
      id: "copy-key",
    });

    expect(describeElement(identityOf(node, 4))).toBe("button[aria-label=Copy]#copy-key");
  });

  test("should fall back to tag, classes and id when nothing semantic survives the gate", () => {
    const node = element(4, "DIV", { class: "m_8fb7ebe7 gm-card", id: "panel" });

    expect(describeElement(identityOf(node, 4))).toBe("div.m_8fb7ebe7.gm-card#panel");
  });

  test("should rank an authored handle above the name and the name above a weaker attribute", () => {
    const testId = element(4, "BUTTON", { "data-testid": "connect", "aria-label": "Connect" });
    const named: ElementIdentity = {
      nodeId: 5,
      tagName: "button",
      classes: [],
      accessibleName: "Connect",
      attributes: { type: "submit", placeholder: "unused" },
    };

    expect(describeElement(identityOf(testId, 4))).toBe("button[data-testid=connect]");
    expect(describeElement(named)).toBe("button[label=Connect]");
  });

  test("should refuse a stored name the delivery scan would not pass, even from a stored row", () => {
    const dirty: ElementIdentity = {
      nodeId: 5,
      tagName: "button",
      classes: ["gm-pay"],
      accessibleName: "ada@example.invalid",
      attributes: {},
    };

    expect(describeElement(dirty)).toBe("button.gm-pay");
  });

  test("should keep every attribute name in DESCRIBE_ATTRIBUTE_PRECEDENCE an attribute", () => {
    expect(DESCRIBE_ATTRIBUTE_PRECEDENCE).toContain("data-testid");
    expect(DESCRIBE_ATTRIBUTE_PRECEDENCE).not.toContain(DESCRIBE_NAME_LABEL);
    expect(
      DESCRIBE_SEMANTIC_PRECEDENCE.filter((source) => source.from === "accessibleName"),
    ).toHaveLength(1);
  });
});
