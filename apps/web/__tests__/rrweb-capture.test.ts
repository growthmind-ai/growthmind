import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  REPLAY_CAPTURE_CONFIG,
  resetReplayCaptureGuardForTests,
  startReplayCapture,
} from "../lib/rrweb-capture";

const KEY = "NEXT_PUBLIC_RRWEB_PUBLIC_KEY";
const originalKey = process.env[KEY];

// The guard is module-level state (one recorder per real page load), so each
// test needs "no page load has happened yet" restored before it runs.
beforeEach(() => {
  resetReplayCaptureGuardForTests();
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env[KEY];
    return;
  }
  process.env[KEY] = originalKey;
});

function throwingStart(): never {
  throw new Error("recorder init failed");
}

function createRecordingStart(): {
  fakeStart: (config: Record<string, unknown>) => void;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    fakeStart: (config) => {
      calls.push(config);
    },
    calls,
  };
}

// AD-5a: the installed SDK exposes no unmask/allowlist seam, so nothing is
// exempted from masking; scan every string/RegExp value to prove that.
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (value instanceof RegExp) {
    out.push(value.source);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, out);
    }
  }
  return out;
}

describe("REPLAY_CAPTURE_CONFIG", () => {
  test("states includePii === false explicitly, not merely leaving it absent", () => {
    expect("includePii" in REPLAY_CAPTURE_CONFIG).toBe(true);
    expect((REPLAY_CAPTURE_CONFIG as Record<string, unknown>).includePii).toBe(false);
  });

  test("masks every input by default", () => {
    expect((REPLAY_CAPTURE_CONFIG as Record<string, unknown>).maskAllInputs).toBe(true);
  });

  test("masks all text via a catch-all selector and exempts nothing (no unmask/allowlist key)", () => {
    expect((REPLAY_CAPTURE_CONFIG as Record<string, unknown>).maskTextSelector).toBe("*");

    const keys = Object.keys(REPLAY_CAPTURE_CONFIG);
    expect(keys.some((key) => /unmask|allow/i.test(key))).toBe(false);

    const strings = collectStrings(REPLAY_CAPTURE_CONFIG);
    expect(strings.some((value) => value.includes("gm-replay-unmasked"))).toBe(false);
  });

  test("carries no meta key today, so a future addition is forced through this file's PII check", () => {
    expect("meta" in REPLAY_CAPTURE_CONFIG).toBe(false);
  });

  test("meta, when present, names no email-like or name-like field", () => {
    const meta = (REPLAY_CAPTURE_CONFIG as Record<string, unknown>).meta;
    const suspicious =
      meta && typeof meta === "object"
        ? Object.keys(meta as Record<string, unknown>).filter((key) => /email|name/i.test(key))
        : [];
    expect(suspicious).toEqual([]);
  });
});

describe("startReplayCapture", () => {
  test("with no public key configured, never starts the recorder and does not throw", () => {
    delete process.env[KEY];
    const { fakeStart, calls } = createRecordingStart();

    expect(() => startReplayCapture(fakeStart)).not.toThrow();
    expect(calls).toEqual([]);
  });

  test("with a public key configured, starts the recorder exactly once with the key and the masking config", () => {
    const testKey = "rrweb_public_key_test_only";
    process.env[KEY] = testKey;
    const { fakeStart, calls } = createRecordingStart();

    startReplayCapture(fakeStart);

    expect(calls.length).toBe(1);
    expect(calls[0]?.publicApiKey).toBe(testKey);

    for (const [key, value] of Object.entries(REPLAY_CAPTURE_CONFIG)) {
      expect(calls[0]?.[key]).toEqual(value);
    }
  });

  test("a recorder that throws on start never breaks the page", () => {
    process.env[KEY] = "rrweb_public_key_test_only";

    expect(() => startReplayCapture(throwingStart)).not.toThrow();
  });

  test("a second call on the same page load adds no second entry to the fake's calls", () => {
    process.env[KEY] = "rrweb_public_key_test_only";
    const { fakeStart, calls } = createRecordingStart();

    startReplayCapture(fakeStart);
    startReplayCapture(fakeStart);

    expect(calls.length).toBe(1);
  });

  test("the guard holds even when the first start threw, so a retry never opens a second recorder", () => {
    process.env[KEY] = "rrweb_public_key_test_only";
    const { fakeStart, calls } = createRecordingStart();

    expect(() => startReplayCapture(throwingStart)).not.toThrow();
    startReplayCapture(fakeStart);

    expect(calls).toEqual([]);
  });
});
