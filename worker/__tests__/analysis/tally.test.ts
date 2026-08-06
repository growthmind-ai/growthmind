import { describe, expect, it } from "bun:test";

import type { AnalysisLane, CallAttribution } from "../../src/analysis/types";
import { addReported, applyAttribution, newTally, outcomeFor } from "../../src/analysis/tally";

const laneWith = (candidates: number, sessionsConsidered: number): AnalysisLane => ({
  organizationId: "org-1",
  organizationName: "Org One",
  projectId: "project-1",

  candidates: Array.from({ length: candidates }) as AnalysisLane["candidates"],
  sessionsConsidered,
});

const attempted = (inputTokens?: number, outputTokens?: number): CallAttribution => ({
  attempted: true,
  resolvedModelId: "model-a",
  usage: { inputTokens, outputTokens },
});

describe("addReported", () => {
  it("leaves a null total null when nothing was reported", () => {
    expect(addReported(null, undefined)).toBeNull();
  });

  it("leaves a numeric total untouched when nothing was reported", () => {
    expect(addReported(7, undefined)).toBe(7);
  });

  it("promotes a null total to the reported value, not to zero-plus-value", () => {
    expect(addReported(null, 5)).toBe(5);
  });

  it("adds a reported zero, because zero reported is not the same as unreported", () => {
    expect(addReported(null, 0)).toBe(0);
  });

  it("accumulates across reports", () => {
    expect(addReported(addReported(null, 3), 4)).toBe(7);
  });
});

describe("applyAttribution", () => {
  it("counts nothing when no call was attempted", () => {
    const tally = newTally();
    applyAttribution(tally, { attempted: false, resolvedModelId: null, usage: {} });

    expect(tally.modelCallsAttempted).toBe(0);
    expect(tally.resolvedModelId).toBeNull();
    expect(tally.tokensIn).toBeNull();
    expect(tally.tokensOut).toBeNull();
  });

  it("keeps tokens null for an attempted call that reported no usage", () => {
    const tally = newTally();
    applyAttribution(tally, attempted());

    expect(tally.modelCallsAttempted).toBe(1);
    expect(tally.resolvedModelId).toBe("model-a");
    expect(tally.tokensIn).toBeNull();
    expect(tally.tokensOut).toBeNull();
  });

  it("records the FIRST model addressed and does not overwrite it", () => {
    const tally = newTally();
    applyAttribution(tally, attempted());
    applyAttribution(tally, {
      attempted: true,
      resolvedModelId: "model-b",
      usage: {},
    });

    expect(tally.modelCallsAttempted).toBe(2);
    expect(tally.resolvedModelId).toBe("model-a");
  });

  it("sums reported usage across several attempted calls", () => {
    const tally = newTally();
    applyAttribution(tally, attempted(10, 2));
    applyAttribution(tally, attempted(5, 3));

    expect(tally.tokensIn).toBe(15);
    expect(tally.tokensOut).toBe(5);
  });

  it("counts an unmetered call alongside a metered one without inventing a zero", () => {
    const tally = newTally();
    applyAttribution(tally, attempted());
    applyAttribution(tally, attempted(8, undefined));

    expect(tally.modelCallsAttempted).toBe(2);
    expect(tally.tokensIn).toBe(8);

    expect(tally.tokensOut).toBeNull();
  });
});

describe("newTally / applyAttribution — the suppressed counter (ADD Decision 5 item 6)", () => {
  it("newTally initializes suppressed to 0, and applyAttribution never touches it", () => {
    // `RunTally` does not carry `suppressed` yet (Wave 3 task 3.3 adds it) — read through a
    // widened view so this Wave 0 red is a real assertion failure (the field is absent) rather
    // than a compile error on a property that does not exist on the production type.
    const tally = newTally();
    const tallyRecord = tally as unknown as Record<string, unknown>;

    expect(tallyRecord.suppressed).toBe(0);

    applyAttribution(tally, attempted(10, 2));

    expect(tallyRecord.suppressed).toBe(0);
  });
});

describe("outcomeFor", () => {
  it("reports findings whenever the lane carried candidates", () => {
    expect(outcomeFor(laneWith(2, 40))).toBe("produced_findings");
  });

  it("distinguishes a quiet product from one never looked at", () => {
    expect(outcomeFor(laneWith(0, 40))).toBe("no_candidates_passed_gate");

    expect(outcomeFor(laneWith(0, 0))).toBe("no_sessions_to_analyse");
  });

  it("reports findings on a lane with candidates even when no sessions were counted", () => {
    expect(outcomeFor(laneWith(1, 0))).toBe("produced_findings");
  });
});
