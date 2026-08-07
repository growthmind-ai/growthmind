import { describe, expect, test } from "bun:test";

import { REPLAY_LANES, stampedExclusionReasonSchema } from "@growthmind/shared";
import type { ReplayLane, ReplaySessionFact, StampedExclusionReason } from "@growthmind/shared";

import { LANE_BY_EXCLUSION_REASON, laneOf } from "../../src/replay-filters/lanes";
import { fact } from "./fixtures";

const ORIGINS = ["real", "synthetic"] as const;

function everyShape(): readonly ReplaySessionFact[] {
  const shapes: ReplaySessionFact[] = [];
  for (const origin of ORIGINS) {
    for (const reason of stampedExclusionReasonSchema.options) {
      shapes.push(fact({ sessionKey: `ph:${origin}-${reason}`, origin, exclusionReason: reason }));
    }
  }
  return shapes;
}

describe("laneOf", () => {
  test("should put a synthetic-origin session in the simulated lane even when its exclusion reason is not none", () => {
    const session = fact({ origin: "synthetic", exclusionReason: "internal_domain" });

    expect(laneOf(session)).toBe("simulated");
  });

  test("should put a real-origin session with exclusion_reason internal_domain in the excluded lane", () => {
    const session = fact({ origin: "real", exclusionReason: "internal_domain" });

    expect(laneOf(session)).toBe("excluded");
  });

  test("should put a real-origin session with exclusion_reason none in the real lane", () => {
    const session = fact({ origin: "real", exclusionReason: "none" });

    expect(laneOf(session)).toBe("real");
  });

  test("should partition a seeded set so every session lands in exactly one lane", () => {
    const seeded = everyShape();
    const byLane: Record<ReplayLane, string[]> = { real: [], simulated: [], excluded: [] };

    for (const session of seeded) {
      const lane = laneOf(session);
      expect(REPLAY_LANES).toContain(lane);
      byLane[lane].push(session.sessionKey);
    }

    const placed = [...byLane.real, ...byLane.simulated, ...byLane.excluded];
    expect(placed).toHaveLength(seeded.length);
    expect(new Set(placed).size).toBe(seeded.length);
  });
});

describe("LANE_BY_EXCLUSION_REASON", () => {
  test("should map exactly the five stamped exclusion reasons and never outside_who_counts", () => {
    const mapped = Object.keys(LANE_BY_EXCLUSION_REASON).toSorted();
    const stamped: readonly StampedExclusionReason[] = stampedExclusionReasonSchema.options;

    expect(mapped).toEqual([...stamped].toSorted());
    expect(mapped).not.toContain("outside_who_counts");
  });
});
