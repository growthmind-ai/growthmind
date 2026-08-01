// The run tally, asserted directly.
//
// Every rule below was already covered. Through `runAnalysisTick`, eight layers up,
// with a fake summariser and a fake claim ledger in the way. That suite proves the lane
// behaves; it is a poor place to prove an arithmetic invariant, because a broken
// `addReported` shows up there as a wrong number on a persisted row and could be
// explained by any of the layers between.
//
// These are the assertions the extraction bought: input in, value out, one rule per
// test.
import { describe, expect, it } from "bun:test";

import type { AnalysisLane, CallAttribution } from "../../src/analysis/types";
import { addReported, applyAttribution, newTally, outcomeFor } from "../../src/analysis/tally";

const laneWith = (candidates: number, sessionsConsidered: number): AnalysisLane => ({
  organizationId: "org-1",
  organizationName: "Org One",
  projectId: "project-1",
  // The tally only ever reads `.length`, so the contents are irrelevant here and a cast
  // keeps a 40-field candidate fixture out of an arithmetic test.
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

    // A call the model served but did not meter must not read as a call that cost
    // nothing. The attempt is counted; the cost stays unknown.
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
    // Neither call reported an output count, so the total is still unknown, not zero.
    expect(tally.tokensOut).toBeNull();
  });
});

describe("outcomeFor", () => {
  it("reports findings whenever the lane carried candidates", () => {
    expect(outcomeFor(laneWith(2, 40))).toBe("produced_findings");
  });

  it("distinguishes a quiet product from one never looked at", () => {
    // Sessions were considered and nothing was solid enough.
    expect(outcomeFor(laneWith(0, 40))).toBe("no_candidates_passed_gate");
    // Nothing was considered at all.
    expect(outcomeFor(laneWith(0, 0))).toBe("no_sessions_to_analyse");
  });

  it("reports findings on a lane with candidates even when no sessions were counted", () => {
    // The direction that matters on a failed run: a broken run must never describe the
    // shape of an empty product.
    expect(outcomeFor(laneWith(1, 0))).toBe("produced_findings");
  });
});
