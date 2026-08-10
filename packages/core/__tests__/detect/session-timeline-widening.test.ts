import { cohortCutsOfUserAgent } from "@growthmind/shared";
import type { ConnectionState } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { detectFunnelDropoff } from "../../src/detect/funnel-dropoff";
import type { DetectorCorpus, SessionTimeline } from "../../src/detect/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { sessionOf } from "../spine/fixtures";

const PROJECT_ID = "prj-o045-session-timeline-widening";
const ORIGIN = "/pricing";
const DESTINATION = "/checkout";

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");

const NOT_CONNECTED: ConnectionState = { status: "not_connected" };

const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const USER_AGENTS: readonly (string | null)[] = [CHROME_ON_WINDOWS, SAFARI_ON_IPHONE, null];

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

function sessions(
  idPrefix: string,
  count: number,
  paths: readonly string[],
  carryCuts: boolean,
): readonly SessionTimeline[] {
  const built: SessionTimeline[] = [];
  for (let index = 0; index < count; index += 1) {
    const session = sessionOf(`${idPrefix}-${String(index)}`, paths);
    if (!carryCuts) {
      built.push(session);
      continue;
    }
    const userAgent = USER_AGENTS[index % USER_AGENTS.length];
    built.push({ ...session, cohortCuts: cohortCutsOfUserAgent(userAgent) });
  }
  return built;
}

function corpusOf(carryCuts: boolean): DetectorCorpus {
  const rules = ruleSetV1();
  const converted = sessions(
    "converted",
    rules.funnelMinDropoffSessions,
    [ORIGIN, DESTINATION],
    carryCuts,
  );
  const dropped = sessions("dropped", rules.funnelMinSessionsAtOrigin, [ORIGIN], carryCuts);
  const all = [...converted, ...dropped];

  return {
    projectId: PROJECT_ID,
    window: { start: WINDOW_START, end: WINDOW_END },
    connectionState: NOT_CONNECTED,
    sessions: all,
    basis: {
      totalInWindow: all.length,
      kept: all.length,
      keptUnchecked: 0,
      setAside: [],
    },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

// Every third session could not be checked against a confirmed audience, and every fifth carried
// no identity at all — enough of each that neither arm of the comparison is empty.
const UNCHECKED_STRIDE = 3;
const UNIDENTIFIED_STRIDE = 5;

function corpusCarryingShippedFields(): DetectorCorpus {
  const base = corpusOf(false);

  const carrying: readonly SessionTimeline[] = base.sessions.map((session, index) => ({
    ...session,
    whoCountsUnchecked: index % UNCHECKED_STRIDE === 0,
    identityGroup: index % UNIDENTIFIED_STRIDE === 0 ? null : index,
  }));

  // The basis is left byte-identical on purpose: the only difference between the two corpora is
  // the two new per-session fields, so a detector output that moves can only have read them.
  return { ...base, sessions: carrying };
}

describe("SessionTimeline gains cohortCuts and no detector output moves (Decision 3)", () => {
  test("should produce identical detector candidates whether or not sessions carry cohort cuts", () => {
    const rules = ruleSetV1();

    const withCuts = detectFunnelDropoff(corpusOf(true), rules);
    const withoutCuts = detectFunnelDropoff(corpusOf(false), rules);

    // A vacuous pass would be two empty arrays agreeing with each other.
    expect(withoutCuts.candidates.length).toBeGreaterThan(0);
    expect(withCuts.candidates).toEqual(withoutCuts.candidates);
  });

  test("should not let an unreadable user agent change a detector candidate", () => {
    const rules = ruleSetV1();

    const withCuts = detectFunnelDropoff(corpusOf(true), rules);
    const withoutCuts = detectFunnelDropoff(corpusOf(false), rules);

    expect(cohortCutsOfUserAgent(null)).toEqual({ browser: "unknown", device: "unknown" });
    expect(withCuts.coverage).toEqual(withoutCuts.coverage);
    expect(withCuts.candidates.map((candidate) => candidate.surface)).toEqual(
      withoutCuts.candidates.map((candidate) => candidate.surface),
    );
  });
});

describe("SessionTimeline gains whoCountsUnchecked and identityGroup and no detector output moves (Decision 2b)", () => {
  test("should produce identical detector candidates whether or not sessions carry whoCountsUnchecked and identityGroup", () => {
    const rules = ruleSetV1();

    const withFields = detectFunnelDropoff(corpusCarryingShippedFields(), rules);
    const withoutFields = detectFunnelDropoff(corpusOf(false), rules);

    // A vacuous pass would be two empty arrays agreeing with each other.
    expect(withoutFields.candidates.length).toBeGreaterThan(0);
    expect(withFields.candidates).toEqual(withoutFields.candidates);
    expect(withFields.coverage).toEqual(withoutFields.coverage);
  });

  test("should leave both fields optional, so a corpus written before either is still a corpus", () => {
    const before = corpusOf(false);

    expect(before.sessions.length).toBeGreaterThan(0);
    expect(before.sessions.every((session) => session.whoCountsUnchecked === undefined)).toBe(true);
    expect(before.sessions.every((session) => session.identityGroup === undefined)).toBe(true);
  });

  test("should carry an identity as an equality class and never as a key", () => {
    const carried = corpusCarryingShippedFields();
    const groups = carried.sessions.map((session) => session.identityGroup);

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some((group) => group === null)).toBe(true);
    expect(groups.filter((group) => group !== null && !Number.isInteger(group))).toEqual([]);
  });

  test("should carry a who_counts verdict per session that the detector still never reads", () => {
    const carried = corpusCarryingShippedFields();
    const unchecked = carried.sessions.filter((session) => session.whoCountsUnchecked === true);

    expect(unchecked.length).toBeGreaterThan(0);
    expect(carried.basis.keptUnchecked).toBe(corpusOf(false).basis.keptUnchecked);
  });
});
