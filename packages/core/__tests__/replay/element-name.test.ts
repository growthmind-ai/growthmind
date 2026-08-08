import { describe, expect, test } from "bun:test";

import { DESCRIBE_VALUE_MAX_LENGTH } from "../../src/replay/describe";
import { resolveIdentity } from "../../src/replay/nodes";
import {
  SIGN_IN_BUTTON_NODE_ID,
  SIGN_IN_DIVIDER_NODE_ID,
  SIGN_IN_EMAIL_NODE_ID,
  SIGN_IN_HEADING_NODE_ID,
  SIGN_IN_LABEL_NODE_ID,
  documentNode,
  element,
  lastSegmentIndex,
  maskedText,
  signInSnapshot,
  snapshotEvent,
  textNode,
} from "./fixtures";
import type { Node } from "./fixtures";

function nameOf(node: Node, nodeId: number): string | undefined {
  const index = lastSegmentIndex([snapshotEvent(0, documentNode([node]))]);
  return resolveIdentity(index, nodeId).accessibleName;
}

describe("the accessible name a recording can be trusted to carry", () => {
  test("should name a field from the label bound to it, which is where a form keeps the name", () => {
    const index = lastSegmentIndex([signInSnapshot()]);

    expect(resolveIdentity(index, SIGN_IN_EMAIL_NODE_ID).accessibleName).toBe("Email");
    expect(resolveIdentity(index, SIGN_IN_LABEL_NODE_ID).accessibleName).toBe("Email");
  });

  test("should read a control's own text through the wrappers a build tool puts around it", () => {
    const nested = element(4, "BUTTON", {}, [
      element(5, "SPAN", {}, [element(6, "SPAN", {}, [textNode(7, "Connect")])]),
    ]);

    expect(nameOf(nested, 4)).toBe("Connect");
  });

  test("should not name a control from a masked text node rather than guess at what it said", () => {
    const masked = element(4, "BUTTON", { class: "gm-submit" }, [maskedText(5)]);
    const partly = element(6, "BUTTON", {}, [maskedText(7, "**** ******")]);

    expect(nameOf(masked, 4)).toBeUndefined();
    expect(nameOf(partly, 6)).toBeUndefined();
  });

  test("should drop only the masked half of a label, never render the asterisks as its name", () => {
    const mixed = element(4, "BUTTON", {}, [
      textNode(5, "Remove"),
      element(6, "SPAN", {}, [maskedText(7, "**** ******")]),
    ]);

    expect(nameOf(mixed, 4)).toBe("Remove");
  });

  test("should not name a control from rrweb's own SCRIPT_PLACEHOLDER substitution", () => {
    const withScript = element(4, "A", { href: "/billing" }, [
      element(5, "SCRIPT", {}, [textNode(6, "SCRIPT_PLACEHOLDER")]),
    ]);

    expect(nameOf(withScript, 4)).toBeUndefined();
  });

  test("should not name a control from a style rule or an aria-hidden decoration", () => {
    const styled = element(4, "BUTTON", {}, [
      element(5, "STYLE", {}, [textNode(6, "body{color:red}")]),
    ]);
    const decorated = element(7, "BUTTON", {}, [
      element(8, "SPAN", { "aria-hidden": "true" }, [textNode(9, "Ⓘ")]),
    ]);

    expect(nameOf(styled, 4)).toBeUndefined();
    expect(nameOf(decorated, 7)).toBeUndefined();
  });

  test("should never take a name from what a person typed into a field", () => {
    const typed = element(4, "INPUT", { value: "ada@example.invalid", type: "email" });

    expect(nameOf(typed, 4)).toBeUndefined();
  });

  test("should refuse a name the delivery scan would not pass", () => {
    const emailed = element(4, "BUTTON", {}, [textNode(5, "ada@example.invalid")]);
    const credentialed = element(6, "A", { href: "/x" }, [textNode(7, "sk-liveABCDEFGHIJKLMNOP")]);

    expect(nameOf(emailed, 4)).toBeUndefined();
    expect(nameOf(credentialed, 6)).toBeUndefined();
  });

  test("should not name anything that is not a control, so page copy is never read as an action", () => {
    const index = lastSegmentIndex([signInSnapshot()]);

    expect(resolveIdentity(index, SIGN_IN_HEADING_NODE_ID).accessibleName).toBeUndefined();
    expect(resolveIdentity(index, SIGN_IN_DIVIDER_NODE_ID).accessibleName).toBeUndefined();
  });

  test("should cap a stored name at DESCRIBE_VALUE_MAX_LENGTH rather than store a paragraph", () => {
    const long = `Connect-${"x".repeat(DESCRIBE_VALUE_MAX_LENGTH * 2)}-repository`;
    const shouted = element(4, "BUTTON", {}, [textNode(5, long)]);
    const stored = nameOf(shouted, 4) ?? "";

    expect(stored.length).toBeLessThanOrEqual(DESCRIBE_VALUE_MAX_LENGTH);
    expect(stored.endsWith("-repository")).toBe(true);
  });

  test("should name a control wrapped in its own label, not only one bound by id", () => {
    const wrapped = element(4, "LABEL", {}, [
      element(5, "INPUT", { type: "checkbox" }),
      textNode(6, "Remember"),
    ]);

    expect(nameOf(wrapped, 5)).toBe("Remember");
  });

  test("should name the button a person actually pressed, phrase and all", () => {
    const index = lastSegmentIndex([signInSnapshot()]);
    const google = element(4, "BUTTON", {}, [
      textNode(5, "Continue with"),
      element(6, "SPAN", {}, [textNode(7, "Google")]),
    ]);
    const github = element(8, "DIV", { role: "button" }, [textNode(9, "Continue with GitHub")]);

    expect(resolveIdentity(index, SIGN_IN_BUTTON_NODE_ID).accessibleName).toBe("Sign in");
    expect(nameOf(google, 4)).toBe("Continue with Google");
    expect(nameOf(github, 8)).toBe("Continue with GitHub");
  });

  test("should not name a link from its own text, which is as often a row of data as a label", () => {
    const person = element(4, "A", { href: "/team/1" }, [textNode(5, "Jane Cooper")]);
    const oneToken = element(6, "A", { href: "/billing" }, [textNode(7, "Billing")]);

    expect(nameOf(person, 4)).toBeUndefined();
    expect(nameOf(oneToken, 6)).toBe("Billing");
  });

  test("should carry a bound label's whole phrase onto the field it names", () => {
    const bound = element(4, "DIV", {}, [
      element(5, "LABEL", { for: "work-email" }, [textNode(6, "Work email")]),
      element(7, "INPUT", { id: "work-email", type: "email" }),
    ]);

    expect(nameOf(bound, 7)).toBe("Work email");
  });

  test("should still refuse a multi-word aria-label, which no element authored (B-052)", () => {
    const labelled = element(4, "BUTTON", { "aria-label": "Delete invoice for Jane Cooper" });

    expect(nameOf(labelled, 4)).toBeUndefined();
  });

  test("should still refuse a button label carrying an email address", () => {
    const emailed = element(4, "BUTTON", {}, [textNode(5, "Email ada@example.invalid now")]);
    const phoned = element(6, "BUTTON", {}, [textNode(7, "Call 555 123 4567 to finish")]);

    expect(nameOf(emailed, 4)).toBeUndefined();
    expect(nameOf(phoned, 6)).toBeUndefined();
  });

  test("should truncate an over-long button label rather than refuse it outright", () => {
    const long = `Connect the ${"very ".repeat(20)}repository`;
    const stored = nameOf(element(4, "BUTTON", {}, [textNode(5, long)]), 4) ?? "";

    expect(stored.length).toBeLessThanOrEqual(DESCRIBE_VALUE_MAX_LENGTH);
    expect(stored.endsWith("repository")).toBe(true);
  });

  test("should not read a name off a control the snapshot never resolved", () => {
    const index = lastSegmentIndex([signInSnapshot()]);

    expect(resolveIdentity(index, 4242).accessibleName).toBeUndefined();
  });
});
