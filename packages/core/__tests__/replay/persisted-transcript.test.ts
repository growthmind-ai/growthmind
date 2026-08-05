import { describe, expect, test } from "bun:test";

import {
  PERSISTED_TRANSCRIPT_VERSION,
  readPersistedTranscript,
  serialisePersistedTranscript,
} from "../../src/index";
import type { ElementIdentity, SessionAction } from "../../src/replay/types";
import {
  bytesOf,
  numberConstantUnderContract,
  readerUnderContract,
  serialiserUnderContract,
} from "./persisted-transcript-contract";

const IDENTIFIER_BEARING_ATTRIBUTE = "data-user-email";

const IDENTIFIER_BEARING_VALUE = "ada@example.invalid";

function elementWith(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    nodeId: 21,
    tagName: "BUTTON",
    id: "save",
    classes: ["gm-submit"],
    role: "button",
    testId: "save-settings",
    attributes: {},
    ...overrides,
  };
}

const FIXTURE_ACTIONS: readonly SessionAction[] = [
  { kind: "page", atMs: 0, href: "https://app.growthmind.test/settings" },
  { kind: "dead_click", atMs: 900, element: elementWith() },
];

describe("serialisePersistedTranscript — the version dispatch and the bounded element", () => {
  test("should refuse a version with no registered serialiser", () => {
    expect(() => serialiserUnderContract()(FIXTURE_ACTIONS, 99)).toThrow(/99/);
  });

  test("should require an integer atMs on every serialised action", () => {
    const fractional: readonly SessionAction[] = [
      { kind: "dead_click", atMs: 1200.6, element: elementWith() },
    ];

    const serialised = serialiserUnderContract()(fractional, 1);

    expect(serialised.actions[0]?.atMs).toBe(1201);
    expect(Number.isInteger(serialised.actions[0]?.atMs)).toBe(true);
    expect(() => bytesOf(serialised)).not.toThrow();
  });

  test("should never persist the raw element attribute map", () => {
    const carrying: readonly SessionAction[] = [
      {
        kind: "dead_click",
        atMs: 900,
        element: elementWith({
          attributes: { [IDENTIFIER_BEARING_ATTRIBUTE]: IDENTIFIER_BEARING_VALUE },
        }),
      },
    ];

    const encoded = bytesOf(serialiserUnderContract()(carrying, 1));

    expect(encoded).not.toContain("attributes");
    expect(encoded).not.toContain(IDENTIFIER_BEARING_ATTRIBUTE);
    expect(encoded).not.toContain(IDENTIFIER_BEARING_VALUE);
  });

  test("should cap persisted classes at PERSISTED_TRANSCRIPT_MAX_CLASSES", () => {
    const cap = numberConstantUnderContract("PERSISTED_TRANSCRIPT_MAX_CLASSES");
    const many = Array.from({ length: 40 }, (_, index) => `gm-c${String(index).padStart(2, "0")}`);

    const serialised = serialiserUnderContract()(
      [{ kind: "dead_click", atMs: 900, element: elementWith({ classes: many }) }],
      1,
    );

    expect(cap).toBe(8);
    expect(serialised.actions[0]?.element?.classes).toEqual(many.slice(0, cap));
  });
});

describe("readPersistedTranscript — the only path from a stored jsonb value to a typed transcript", () => {
  test("should return null when reading a row written before the actions column existed", () => {
    const read = readerUnderContract();

    expect(read(null)).toBeNull();
    expect(read(undefined)).toBeNull();
  });

  test("should return null for a stored version it has no reader for", () => {
    expect(readerUnderContract()({ v: 99, actions: [] })).toBeNull();
  });

  test("should return null for a v1 payload carrying an unknown action kind", () => {
    const withAnUnknownKind = {
      v: 1,
      actions: [
        { kind: "dead_click", atMs: 900, element: { nodeId: 21, tag: "BUTTON", classes: [] } },
        { kind: "form_submit", atMs: 1800 },
      ],
    };

    expect(readerUnderContract()(withAnUnknownKind)).toBeNull();
  });

  test("should read back a transcript the current serialiser just wrote", () => {
    const version = numberConstantUnderContract("PERSISTED_TRANSCRIPT_VERSION");
    const written = serialiserUnderContract()(FIXTURE_ACTIONS, version);

    const read = readerUnderContract()(JSON.parse(JSON.stringify(written)) as unknown);

    expect(read).not.toBeNull();
    expect(read?.actions).toHaveLength(FIXTURE_ACTIONS.length);
    expect(read?.actions[0]?.atMs).toBe(0);
  });
});

describe("the barrel is the entry point O-044 reads, not the module path", () => {
  test("should round-trip through the statically imported @growthmind/core symbols", () => {
    const written = serialisePersistedTranscript(FIXTURE_ACTIONS, PERSISTED_TRANSCRIPT_VERSION);

    expect(written.v).toBe(PERSISTED_TRANSCRIPT_VERSION);
    expect(readPersistedTranscript(written)?.actions).toHaveLength(FIXTURE_ACTIONS.length);
  });
});
