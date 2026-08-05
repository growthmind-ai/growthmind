import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { REPLAY_MASKING } from "../lib/replay-masking";
import { REPLAY_CAPTURE_CONFIG } from "../lib/rrweb-capture";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEXT_MASKING_KEYS = ["maskTextSelector", "maskTextClass", "maskTextFn"];

function instrumentationSource(): string {
  return readFileSync(path.join(WEB_ROOT, "instrumentation-client.ts"), "utf8");
}

describe("replay masking", () => {
  // Deliberate while the app has only team users on it — see B-050, which is the trip-wire
  // for turning it back on. The test states the shipped posture so a change is a decision.
  test("text and non-password inputs are recorded as they appear", () => {
    expect(REPLAY_MASKING.maskAllInputs).toBe(false);

    for (const key of TEXT_MASKING_KEYS) {
      expect(key in REPLAY_MASKING).toBe(false);
    }
  });

  // The one exception, and it does not move with the switch above: a password in a third
  // party's storage is a credential, not a workspace name.
  test("password fields stay masked whatever else does not", () => {
    expect(REPLAY_MASKING.maskInputOptions.password).toBe(true);
  });

  // B-049: a recording of every word on screen shipped because posthog.init named no
  // session_recording key at all, so the vendor default applied and nobody had chosen it.
  // Whatever the posture, it has to be stated here rather than inherited.
  test("posthog is initialised from this config rather than from its own default", () => {
    const source = instrumentationSource();

    expect(source).toContain("session_recording: REPLAY_MASKING");
    expect(source).toContain('from "./lib/replay-masking"');
  });

  test("both recorders read the same config, so neither can drift", () => {
    for (const [key, value] of Object.entries(REPLAY_MASKING)) {
      expect(REPLAY_CAPTURE_CONFIG[key as keyof typeof REPLAY_CAPTURE_CONFIG]).toBe(value);
    }
  });
});
