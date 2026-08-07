import { describe, expect, test } from "bun:test";

import { DELIVERY_TICK_INTERVAL_MS } from "@growthmind/core";
import {
  DELIVERY_LANE_DECISIONS,
  DELIVERY_LANE_DECISION_MESSAGES,
  NOTHING_TODAY_REASON_MESSAGES,
} from "@growthmind/shared";

import {
  SILENCE_BEFORE_ALARM_MS,
  laneHistory,
  laneLine,
  type LaneRunFacts,
} from "../../components/channel/lane";

const NOW = new Date("2026-08-05T09:26:00.000Z");

function run(over: Partial<LaneRunFacts> = {}): LaneRunFacts {
  return {
    decision: "nothing_today",
    reason: NOTHING_TODAY_REASON_MESSAGES.no_findings_ready,
    firstDecidedAt: new Date("2026-08-02T09:00:00.000Z"),
    lastDecidedAt: new Date("2026-08-05T09:15:00.000Z"),
    ...over,
  };
}

function ticksAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DELIVERY_TICK_INTERVAL_MS);
}

function silentFor(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const A_MINUTE = 60_000;

describe("not having looked yet is not the same answer as having found nothing", () => {
  test("no open run reads as cold, not as quiet and not as an alarm", () => {
    const line = laneLine(null, NOW);

    expect(line?.tone).toBe("cold");
    expect(line?.head).toBe("We have not looked yet.");
  });
});

describe("a worker that stops writes nothing, so staleness is the only heartbeat", () => {
  test("a run reconfirmed recently keeps saying what it decided", () => {
    expect(laneLine(run({ lastDecidedAt: ticksAgo(1) }), NOW)?.tone).toBe("quiet");
  });

  test("a run one minute short of the window still reads as quiet", () => {
    const line = laneLine(
      run({ lastDecidedAt: silentFor(SILENCE_BEFORE_ALARM_MS - A_MINUTE) }),
      NOW,
    );

    expect(line?.tone).toBe("quiet");
  });

  test("silence past the window outranks whatever the run last said", () => {
    const dead = run({ lastDecidedAt: silentFor(SILENCE_BEFORE_ALARM_MS) });
    const line = laneLine(dead, NOW);

    expect(line?.tone).toBe("alarm");
    expect(line?.head).toContain("We have not checked since");
    // The reassurance the open run would otherwise keep asserting forever.
    expect(line?.head).not.toContain("Quiet since");
  });

  // The incident behind .ai/decisions/0021: "3 ticks" was written against an assumed hourly
  // cadence and meant 45 minutes against the real 15-minute one. A window held as a duration
  // means the same thing whatever the schedule does, so this test pins the threshold in
  // minutes rather than in ticks — change the cadence and it must still pass.
  test("the window is a duration, so a change of cadence cannot silently re-scale it", () => {
    const justUnder = laneLine(run({ lastDecidedAt: silentFor(119 * A_MINUTE) }), NOW);
    const justOver = laneLine(run({ lastDecidedAt: silentFor(121 * A_MINUTE) }), NOW);

    expect(justUnder?.tone).toBe("quiet");
    expect(justOver?.tone).toBe("alarm");
  });
});

describe("eight decisions, four prominences — the lane speaks only where the page is silent", () => {
  for (const decision of ["posted", "failed", "blocked_by_pii", "not_claimed"] as const) {
    test(`${decision} renders no lane line, because a card already carries it`, () => {
      expect(
        laneLine(run({ decision, reason: DELIVERY_LANE_DECISION_MESSAGES[decision] }), NOW),
      ).toBeNull();
    });
  }

  test("not_connected renders no lane line, because the banner is more specific", () => {
    const covered = run({
      decision: "not_connected",
      reason: DELIVERY_LANE_DECISION_MESSAGES.not_connected,
    });

    expect(laneLine(covered, NOW)).toBeNull();
  });

  for (const decision of ["lane_errored", "unresolvable"] as const) {
    test(`${decision} is an alarm, because that failure is ours`, () => {
      const ours = run({ decision, reason: DELIVERY_LANE_DECISION_MESSAGES[decision] });

      expect(laneLine(ours, NOW)?.tone).toBe("alarm");
    });
  }

  test("every decision in the union has a prominence, so a ninth cannot slip through untreated", () => {
    for (const decision of DELIVERY_LANE_DECISIONS) {
      const line = laneLine(
        run({ decision, reason: DELIVERY_LANE_DECISION_MESSAGES[decision] }),
        NOW,
      );

      expect(line === null || ["quiet", "alarm", "cold"].includes(line.tone)).toBe(true);
    }
  });
});

describe("quiet is dated from the run's start and worded by the run itself", () => {
  test("the date is the open run's first decision, not its most recent tick", () => {
    expect(laneLine(run(), NOW)?.head).toBe("Quiet since 2 Aug.");
  });

  test("the three quiet reasons are rendered verbatim rather than flattened into one", () => {
    for (const reason of Object.values(NOTHING_TODAY_REASON_MESSAGES)) {
      expect(laneLine(run({ reason }), NOW)?.body).toBe(reason);
    }
  });

  test("a stored reason outside the shared vocabulary is replaced, never printed", () => {
    const leaked = run({ reason: "TypeError: cannot read property 'ok' of undefined at post()" });
    const line = laneLine(leaked, NOW);

    expect(line?.body).toBe(DELIVERY_LANE_DECISION_MESSAGES.nothing_today);
    expect(line?.body).not.toContain("TypeError");
  });
});

describe("history is runs, not ticks", () => {
  test("a run spanning days carries its span, and a one-day run carries one date", () => {
    const rows = laneHistory([
      run(),
      run({
        firstDecidedAt: new Date("2026-08-01T09:00:00.000Z"),
        lastDecidedAt: new Date("2026-08-01T09:00:00.000Z"),
        decision: "posted",
        reason: DELIVERY_LANE_DECISION_MESSAGES.posted,
      }),
    ]);

    expect(rows[0]?.when).toBe("2 Aug – 5 Aug");
    expect(rows[1]?.when).toBe("1 Aug");
    expect(rows[1]?.what).toBe(DELIVERY_LANE_DECISION_MESSAGES.posted);
  });
});
