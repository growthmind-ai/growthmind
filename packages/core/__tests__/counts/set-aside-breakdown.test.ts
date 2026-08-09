import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import type { ExclusionReason } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { buildSetAsideBreakdown } from "../../src/counts/set-aside-breakdown";

function tallyOf(
  counts: readonly (readonly [ExclusionReason, number])[],
): ReadonlyMap<ExclusionReason, number> {
  return new Map(counts);
}

describe("buildSetAsideBreakdown, from its packages/core home", () => {
  test("should order the breakdown by count and settle a tie by reason", () => {
    const breakdown = buildSetAsideBreakdown({
      unit: "sessions",
      countsByReason: tallyOf([
        ["internal_domain", 3],
        ["automation_headless", 9],
        ["automation_known_agent", 3],
      ]),
    });

    expect(breakdown.map((row) => row.reason)).toEqual([
      "automation_headless",
      "automation_known_agent",
      "internal_domain",
    ]);
    expect(breakdown.map((row) => row.count)).toEqual([9, 3, 3]);
  });

  test("should carry the reader-facing label for every reason it names", () => {
    const breakdown = buildSetAsideBreakdown({
      unit: "sessions",
      countsByReason: tallyOf([["internal_domain", 4]]),
    });

    expect(breakdown.length).toBeGreaterThan(0);
    expect(breakdown.map((row) => row.label)).toEqual([EXCLUSION_REASON_LABELS.internal_domain]);
  });

  test("should return nothing when nothing was set aside", () => {
    expect(buildSetAsideBreakdown({ unit: "events", countsByReason: tallyOf([]) })).toEqual([]);
  });
});
