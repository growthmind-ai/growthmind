import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { REPLAY_MASKING } from "../lib/replay-masking";
import { REPLAY_CAPTURE_CONFIG } from "../lib/rrweb-capture";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function instrumentationSource(): string {
  return readFileSync(path.join(WEB_ROOT, "instrumentation-client.ts"), "utf8");
}

describe("replay masking", () => {
  test("every text node and every input is masked", () => {
    expect(REPLAY_MASKING.maskAllInputs).toBe(true);
    expect(REPLAY_MASKING.maskTextSelector).toBe("*");
  });

  // B-049: a recording of every word on screen was shipping because posthog.init named no
  // session_recording key at all. The default is the bug, so absence has to fail.
  test("posthog is initialised with the masking rather than its default", () => {
    const source = instrumentationSource();

    expect(source).toContain("session_recording: REPLAY_MASKING");
    expect(source).toContain('from "./lib/replay-masking"');
  });

  test("both recorders mask from the same source, so neither can drift", () => {
    for (const [key, value] of Object.entries(REPLAY_MASKING)) {
      expect(REPLAY_CAPTURE_CONFIG[key as keyof typeof REPLAY_CAPTURE_CONFIG]).toBe(value);
    }
  });

  test("no exemption is carved back out of the catch-all", () => {
    const keys = [...Object.keys(REPLAY_MASKING), ...Object.keys(REPLAY_CAPTURE_CONFIG)];

    expect(keys.filter((key) => /unmask|allow|ignore/i.test(key))).toEqual([]);
  });
});
