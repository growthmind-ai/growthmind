import { describe, expect, test } from "bun:test";

import type { ElementIdentity, SessionAction } from "../../src/replay/types";
import { bytesOf, serialiserUnderContract } from "./persisted-transcript-contract";
import type { PersistedTranscript } from "./persisted-transcript-contract";

const SETTINGS_HREF = "https://app.growthmind.test/settings";

const SUBMIT_ELEMENT: ElementIdentity = {
  nodeId: 21,
  tagName: "BUTTON",
  id: "save",
  classes: ["gm-submit", "gm-primary"],
  role: "button",
  testId: "save-settings",
  attributes: { "data-user-email": "someone@example.invalid", title: "Save settings" },
};

const FIXTURE_ACTIONS: readonly SessionAction[] = [
  { kind: "page", atMs: 0, href: SETTINGS_HREF },
  { kind: "rage_click", atMs: 1200, element: SUBMIT_ELEMENT, clicks: 4, spanMs: 900 },
  { kind: "wait", atMs: 2100, durationMs: 3000 },
];

const GOLDEN =
  '{"actions":[' +
  `{"atMs":0,"href":"${SETTINGS_HREF}","kind":"page"},` +
  '{"atMs":1200,"clicks":4,"element":{"classes":["gm-primary","gm-submit"],"id":"save",' +
  '"nodeId":21,"role":"button","tag":"BUTTON","testId":"save-settings"},' +
  '"kind":"rage_click","spanMs":900},' +
  '{"atMs":2100,"durationMs":3000,"kind":"wait"}' +
  '],"v":1}';

type TestLocalFormSubmitAction = {
  readonly kind: "form_submit";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

type BumpedSessionAction = SessionAction | TestLocalFormSubmitAction;

const FORM_SUBMIT: TestLocalFormSubmitAction = {
  kind: "form_submit",
  atMs: 1800,
  element: SUBMIT_ELEMENT,
};

const BUMPED_VOCABULARY: readonly BumpedSessionAction[] = [
  { kind: "page", atMs: 0, href: SETTINGS_HREF },
  FORM_SUBMIT,
  { kind: "rage_click", atMs: 1200, element: SUBMIT_ELEMENT, clicks: 4, spanMs: 900 },
  { kind: "wait", atMs: 2100, durationMs: 3000 },
];

function carriedForward(actions: readonly BumpedSessionAction[]): readonly SessionAction[] {
  return actions.filter((action): action is SessionAction => action.kind !== "form_submit");
}

function testLocalSerialiseV2(actions: readonly BumpedSessionAction[]): PersistedTranscript {
  const submitted = actions.filter(
    (action): action is TestLocalFormSubmitAction => action.kind === "form_submit",
  );

  return {
    v: 2,
    actions: [
      ...serialiserUnderContract()(carriedForward(actions), 1).actions,
      ...submitted.map((action) => ({ kind: action.kind, atMs: action.atMs })),
    ],
  };
}

describe("persisted-transcript churn fixture — recomputed across an action-vocabulary bump", () => {
  test("should serialise a fixture transcript to the golden canonical string at v1", () => {
    expect(bytesOf(serialiserUnderContract()(FIXTURE_ACTIONS, 1))).toBe(GOLDEN);
  });

  test("should encode an action kind by name, never by ordinal", () => {
    const encoded = bytesOf(serialiserUnderContract()(FIXTURE_ACTIONS, 1));

    expect(encoded).toContain('"kind":"rage_click"');
    expect(encoded).not.toMatch(/"kind":\s*-?\d/);
    expect(encoded).not.toMatch(/"kindIndex"|"kindOrdinal"/);
  });

  test("should keep a v1 transcript byte-identical after a twelfth action kind joins the vocabulary", () => {
    const surviving = carriedForward(BUMPED_VOCABULARY);

    expect(surviving).toHaveLength(FIXTURE_ACTIONS.length);
    expect(bytesOf(serialiserUnderContract()(surviving, 1))).toBe(GOLDEN);
  });

  test("should carry every v1 action forward byte-identically through a v2 that knows the twelfth kind", () => {
    const migrated = testLocalSerialiseV2(BUMPED_VOCABULARY);

    expect(migrated.v).toBe(2);
    expect(migrated.actions.some((action) => action.kind === "form_submit")).toBe(true);

    const withoutTheNewKind: PersistedTranscript = {
      v: 1,
      actions: migrated.actions.filter((action) => action.kind !== "form_submit"),
    };

    expect(bytesOf(withoutTheNewKind)).toBe(GOLDEN);
  });

  test("should refuse to serialise an action kind v1 was not written for", () => {
    const unknownToV1 = [FORM_SUBMIT] as unknown as readonly SessionAction[];

    expect(() => serialiserUnderContract()(unknownToV1, 1)).toThrow(/form_submit/);
    expect(() => serialiserUnderContract()(unknownToV1, 1)).toThrow(/v2/i);
  });
});
