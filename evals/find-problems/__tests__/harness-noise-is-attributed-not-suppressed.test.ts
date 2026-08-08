import { describe, expect, it } from "bun:test";

import type { ConsoleErrorRecord } from "../src/protocol";
import {
  assertHarnessNoiseUnchanged,
  attributeConsoleErrors,
  HarnessNoiseMovedError,
  isKnownHarnessNoise,
  KNOWN_HARNESS_SIGNATURES,
  MAX_HARNESS_OCCURRENCES_PER_SESSION,
} from "../src/session/console-attribution";

const APP = "http://localhost:3000";
const NOISE = KNOWN_HARNESS_SIGNATURES[0]!;

function on(url: string, message: string): ConsoleErrorRecord {
  return { message, url };
}

const noiseOnApp = (count: number): ConsoleErrorRecord[] =>
  Array.from({ length: count }, () => on(`${APP}/sign-in`, NOISE));

describe("a console error is attributed, and the allowlist cannot grow quietly", () => {
  it("allows exactly one known harness signature", () => {
    expect(KNOWN_HARNESS_SIGNATURES.length).toBe(1);
    expect(NOISE).toBe("Maximum call stack size exceeded");
  });

  it("keeps harness noise rather than deleting it", () => {
    const attributed = attributeConsoleErrors(noiseOnApp(2), APP);

    expect(attributed.harness.length).toBe(2);
    expect(attributed.app).toEqual([]);
  });

  it("passes anything that is not the one known signature through as app evidence", () => {
    const real = "Failed to load resource: the server responded with a status of 500";
    const attributed = attributeConsoleErrors(
      [on(`${APP}/sign-in`, NOISE), on(`${APP}/sign-in`, real)],
      APP,
    );

    expect(attributed.app).toEqual([real]);
    expect(attributed.harness).toEqual([NOISE]);
  });

  it("never treats another company's site as evidence about our product", () => {
    const attributed = attributeConsoleErrors(
      [on("https://slack.com/workspace-signin", "Slack broke"), on(`${APP}/sign-in`, "we broke")],
      APP,
    );

    expect(attributed.app).toEqual(["we broke"]);
    expect(attributed.offOrigin).toEqual(["Slack broke"]);
  });

  it("stays silent at the measured number of occurrences", () => {
    expect(() =>
      assertHarnessNoiseUnchanged("s-one", noiseOnApp(MAX_HARNESS_OCCURRENCES_PER_SESSION), APP),
    ).not.toThrow();
  });

  it("fails the run when a third occurrence appears on our own origin", () => {
    expect(() =>
      assertHarnessNoiseUnchanged(
        "s-one",
        noiseOnApp(MAX_HARNESS_OCCURRENCES_PER_SESSION + 1),
        APP,
      ),
    ).toThrow(HarnessNoiseMovedError);
  });

  it("does not fail on noise from a site the persona was sent to, whose DOM is not ours", () => {
    const offOrigin = Array.from({ length: 14 }, () =>
      on("https://slack.com/workspace-signin", NOISE),
    );

    expect(() => assertHarnessNoiseUnchanged("s-engineer", offOrigin, APP)).not.toThrow();
    expect(attributeConsoleErrors(offOrigin, APP).app).toEqual([]);
  });

  it("names the session and what to do in the failure message", () => {
    try {
      assertHarnessNoiseUnchanged("s-vibe-builder", noiseOnApp(3), APP);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("s-vibe-builder");
      expect((error as Error).message).toContain("NEXT_PUBLIC_RRWEB_PUBLIC_KEY");
    }
  });

  it("stays silent on a session with no console errors at all", () => {
    expect(() => assertHarnessNoiseUnchanged("s-clean", [], APP)).not.toThrow();
    expect(attributeConsoleErrors([], APP)).toEqual({ app: [], harness: [], offOrigin: [] });
  });

  it("does not treat a merely similar message as the known signature", () => {
    expect(isKnownHarnessNoise("Maximum retries exceeded")).toBe(false);
    expect(isKnownHarnessNoise("call stack")).toBe(false);
  });

  it("treats an unparseable url as off our origin rather than as evidence", () => {
    expect(attributeConsoleErrors([on("about:blank", "mystery")], APP).offOrigin).toEqual([
      "mystery",
    ]);
  });

  it("deduplicates app evidence without dropping a distinct message", () => {
    const errors = ["boom", "boom", "bang"].map((message) => on(`${APP}/x`, message));

    expect(attributeConsoleErrors(errors, APP).app).toEqual(["boom", "bang"]);
  });

  it("truncates a very long app message rather than discarding it", () => {
    const [only] = attributeConsoleErrors([on(`${APP}/x`, "x".repeat(400))], APP).app;

    expect(only?.length).toBe(160);
  });
});
