import { describe, expect, test } from "bun:test";

import * as core from "../../src/index";
import {
  UNKNOWN_TAG_NAME,
  isInteractive,
  isUnknownIdentity,
  unknownIdentity,
} from "../../src/replay/nodes";
import type { ElementIdentity } from "../../src/replay/types";

type ElementKeyUnderContract = {
  readonly key: string;
  readonly tier: "stable" | "structural";
};

type StableElementKey = (identity: ElementIdentity) => ElementKeyUnderContract | null;
type IsStructurallyAnonymous = (identity: ElementIdentity) => boolean;

const MISSING = (name: string, shape: string): string =>
  `@growthmind/core exports no ${name}. ADD §2 D-10 requires ` +
  `packages/core/src/evidence/element-key.ts to declare ${shape} and src/index.ts to export it ` +
  `beside the existing evidence exports.`;

function exported(name: string): unknown {
  return (core as unknown as Record<string, unknown>)[name];
}

function stableElementKey(identity: ElementIdentity): ElementKeyUnderContract | null {
  const found = exported("stableElementKey");

  if (typeof found !== "function") {
    throw new Error(
      MISSING(
        "stableElementKey",
        "stableElementKey(identity: ElementIdentity): ElementKey | null, where " +
          'ElementKey = { readonly key: string; readonly tier: "stable" | "structural" }',
      ),
    );
  }

  return (found as StableElementKey)(identity);
}

function isStructurallyAnonymous(identity: ElementIdentity): boolean {
  const found = exported("isStructurallyAnonymous");

  if (typeof found !== "function") {
    throw new Error(
      MISSING(
        "isStructurallyAnonymous",
        "isStructurallyAnonymous(identity: ElementIdentity): boolean",
      ),
    );
  }

  return (found as IsStructurallyAnonymous)(identity);
}

function keyOf(identity: ElementIdentity): string {
  const resolved = stableElementKey(identity);

  if (resolved === null) {
    throw new Error(
      `expected a key for <${identity.tagName}> at node ${String(identity.nodeId)}, got null`,
    );
  }

  return resolved.key;
}

describe("stableElementKey", () => {
  test("should return no key for an element whose node id never resolved", () => {
    const neverResolved = unknownIdentity(7);

    expect(isUnknownIdentity(neverResolved)).toBe(true);
    expect(stableElementKey(neverResolved)).toBeNull();

    // Separates Gap 2(a) from Gap 2(b): an unresolved node stays keyless even when the
    // recording left classes on it, so the null is the unknown-identity clause.
    const unresolvedButClassed: ElementIdentity = {
      nodeId: 7,
      tagName: UNKNOWN_TAG_NAME,
      classes: ["control", "control--primary"],
      attributes: {},
    };

    expect(isStructurallyAnonymous(unresolvedButClassed)).toBe(false);
    expect(stableElementKey(unresolvedButClassed)).toBeNull();
  });

  test("should return no key for an element with no testId, no id and no classes", () => {
    const anonymous: ElementIdentity = {
      nodeId: 1,
      tagName: "div",
      classes: [],
      attributes: {},
    };

    expect(isUnknownIdentity(anonymous)).toBe(false);
    expect(isStructurallyAnonymous(anonymous)).toBe(true);
    expect(stableElementKey(anonymous)).toBeNull();
  });

  test("should return no key for an interactive element carrying nothing distinguishing", () => {
    const bareButton: ElementIdentity = {
      nodeId: 2,
      tagName: "button",
      classes: [],
      attributes: {},
    };

    expect(isInteractive(bareButton)).toBe(true);
    expect(isStructurallyAnonymous(bareButton)).toBe(true);
    expect(stableElementKey(bareButton)).toBeNull();
  });

  test("should prefer testId over id when building a stable-tier key", () => {
    const withBoth: ElementIdentity = {
      nodeId: 3,
      tagName: "input",
      id: "email-input",
      classes: [],
      testId: "signup-email",
      attributes: {},
    };
    const idRenamed: ElementIdentity = { ...withBoth, id: "email-field" };
    const testIdRenamed: ElementIdentity = { ...withBoth, testId: "signup-password" };
    const idOnly: ElementIdentity = {
      nodeId: 4,
      tagName: "input",
      id: "email-input",
      classes: [],
      attributes: {},
    };

    expect(stableElementKey(withBoth)?.tier).toBe("stable");
    expect(stableElementKey(idOnly)?.tier).toBe("stable");

    expect(keyOf(idRenamed)).toBe(keyOf(withBoth));
    expect(keyOf(testIdRenamed)).not.toBe(keyOf(withBoth));
    expect(keyOf(idOnly)).not.toBe(keyOf(withBoth));
  });

  test("should build a structural-tier key from tagName, role and sorted classes", () => {
    const ordered: ElementIdentity = {
      nodeId: 5,
      tagName: "div",
      classes: ["alpha", "beta", "gamma"],
      role: "button",
      attributes: {},
    };
    const reordered: ElementIdentity = { ...ordered, classes: ["gamma", "alpha", "beta"] };
    const otherTag: ElementIdentity = { ...ordered, tagName: "span" };
    const otherRole: ElementIdentity = { ...ordered, role: "link" };
    const otherClasses: ElementIdentity = { ...ordered, classes: ["alpha", "beta", "delta"] };

    expect(stableElementKey(ordered)?.tier).toBe("structural");

    expect(keyOf(reordered)).toBe(keyOf(ordered));
    expect(keyOf(otherTag)).not.toBe(keyOf(ordered));
    expect(keyOf(otherRole)).not.toBe(keyOf(ordered));
    expect(keyOf(otherClasses)).not.toBe(keyOf(ordered));
  });

  test("should return the same key for one field re-rendered under two node ids", () => {
    const beforeRender: ElementIdentity = {
      nodeId: 11,
      tagName: "input",
      classes: ["field"],
      testId: "signup-email",
      attributes: {},
    };
    const afterRender: ElementIdentity = { ...beforeRender, nodeId: 412 };
    const afterRestyle: ElementIdentity = { ...afterRender, classes: ["field", "field--error"] };

    expect(stableElementKey(beforeRender)?.tier).toBe("stable");
    expect(keyOf(afterRender)).toBe(keyOf(beforeRender));
    expect(keyOf(afterRestyle)).toBe(keyOf(beforeRender));
  });

  test("should never read attributes into an element key", () => {
    const stableBase: ElementIdentity = {
      nodeId: 21,
      tagName: "input",
      classes: [],
      testId: "signup-email",
      attributes: {},
    };
    const stableWithAttributes: ElementIdentity = {
      ...stableBase,
      attributes: { value: "person@example.com", placeholder: "Work email" },
    };

    const structuralBase: ElementIdentity = {
      nodeId: 22,
      tagName: "div",
      classes: ["card"],
      attributes: {},
    };
    const structuralWithAttributes: ElementIdentity = {
      ...structuralBase,
      attributes: { title: "Card", "data-account": "acct_synthetic" },
    };

    expect(keyOf(stableWithAttributes)).toBe(keyOf(stableBase));
    expect(keyOf(structuralWithAttributes)).toBe(keyOf(structuralBase));
  });
});
