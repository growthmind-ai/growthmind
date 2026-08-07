import { describe, expect, test } from "bun:test";

import type { ReplaySessionFact } from "@growthmind/shared";

import { wayOut } from "../../src/replay-filters/way-out";
import { fact, filtersOf } from "./fixtures";

const RESTORED: readonly ReplaySessionFact[] = [fact({ sessionKey: "ph:restored" })];
const NOTHING: readonly ReplaySessionFact[] = [];

describe("wayOut", () => {
  test("should name the single filter that restores results when exactly one does", () => {
    const outcome = wayOut({
      filters: filtersOf({ company: "acme.com", entry: "/pricing" }),
      relaxingCompany: NOTHING,
      relaxingEntry: RESTORED,
      relaxingLane: NOTHING,
    });

    expect(outcome).toEqual({ relax: "entry" });
  });

  test("should return clear-all when two filters each restore results alone", () => {
    const outcome = wayOut({
      filters: filtersOf({ company: "acme.com", entry: "/pricing" }),
      relaxingCompany: RESTORED,
      relaxingEntry: RESTORED,
      relaxingLane: NOTHING,
    });

    expect(outcome).toBe("clear_all");
  });

  test("should return clear-all when no single filter restores results and two or more are active", () => {
    const outcome = wayOut({
      filters: filtersOf({ company: "acme.com", entry: "/pricing" }),
      relaxingCompany: NOTHING,
      relaxingEntry: NOTHING,
      relaxingLane: NOTHING,
    });

    expect(outcome).toBe("clear_all");
  });

  test("should return the empty-lane outcome when one filter is active and relaxing it restores nothing", () => {
    const outcome = wayOut({
      filters: filtersOf({ company: "acme.com" }),
      relaxingCompany: NOTHING,
      relaxingEntry: NOTHING,
      relaxingLane: NOTHING,
    });

    expect(outcome).toBe("no_replays_yet");
    expect(outcome).not.toBe("clear_all");
    expect(outcome).not.toEqual({ relax: "company" });
  });

  test("should return the no-sessions outcome when no filter is active and the lane is empty", () => {
    const outcome = wayOut({
      filters: filtersOf(),
      relaxingCompany: NOTHING,
      relaxingEntry: NOTHING,
      relaxingLane: NOTHING,
    });

    expect(outcome).toBe("no_replays_yet");
  });
});
