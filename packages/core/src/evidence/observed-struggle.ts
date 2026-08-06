import { normaliseUrlPath } from "@growthmind/shared";

import { measuredCount } from "../counts/measured-count";
import { analysedSessions } from "../detect/analysed";
import type { DetectorCandidate, DetectorCorpus } from "../detect/types";
import { isInteractive } from "../replay/nodes";
import type {
  DeadClickAction,
  FieldAbandonedAction,
  FieldRefocusAction,
  RageClickAction,
  ScrollBackAction,
  SessionAction,
  SessionTranscript,
} from "../replay/types";
import type { ThresholdRuleSet } from "../rules/types";
import type { ElementKey } from "./element-key";
import { stableElementKey } from "./element-key";
import type { ObservedStruggleSubkind } from "./signals";
import { observedStruggleSubkindSchema } from "./signals";

// A tie-break, not a threshold, so it stays out of ThresholdRuleSet — see ADD D-12.
export const OBSERVED_STRUGGLE_PRECEDENCE: Readonly<Record<ObservedStruggleSubkind, number>> = {
  rage_click: 0,
  field_abandoned: 1,
  dead_click: 2,
  field_refocus: 3,
  scroll_back: 4,
};

const SUBKINDS_BY_PRECEDENCE: readonly ObservedStruggleSubkind[] =
  observedStruggleSubkindSchema.options.toSorted(
    (left, right) => OBSERVED_STRUGGLE_PRECEDENCE[left] - OBSERVED_STRUGGLE_PRECEDENCE[right],
  );

const NO_MAGNITUDE = 0;
const ONE_BEAT = 1;

type ObservedBeat =
  RageClickAction | DeadClickAction | FieldAbandonedAction | FieldRefocusAction | ScrollBackAction;

type SessionTally = {
  rageMax: number;
  refocusMax: number;
  scrollBacks: number;
  readonly deadRepeats: Map<string, number>;
  readonly abandonedKeys: Set<string>;
};

type SurfaceAccumulator = {
  reachedSessions: number;
  readonly tallies: SessionTally[];
};

type WinningSubkind = {
  readonly subkind: ObservedStruggleSubkind;
  readonly attempts: number;
  readonly qualifyingSessions: number;
};

function observedBeatOf(action: SessionAction): ObservedBeat | null {
  switch (action.kind) {
    case "rage_click":
    case "dead_click":
    case "field_abandoned":
    case "field_refocus":
    case "scroll_back":
      return action;
    default:
      return null;
  }
}

function emptyTally(): SessionTally {
  return {
    rageMax: NO_MAGNITUDE,
    refocusMax: NO_MAGNITUDE,
    scrollBacks: NO_MAGNITUDE,
    deadRepeats: new Map(),
    abandonedKeys: new Set(),
  };
}

function tallyFor(visited: Map<string, SessionTally>, surface: string): SessionTally {
  const existing = visited.get(surface);
  if (existing !== undefined) return existing;

  const created = emptyTally();
  visited.set(surface, created);
  return created;
}

function accumulatorFor(
  surfaces: Map<string, SurfaceAccumulator>,
  surface: string,
): SurfaceAccumulator {
  const existing = surfaces.get(surface);
  if (existing !== undefined) return existing;

  const created: SurfaceAccumulator = { reachedSessions: NO_MAGNITUDE, tallies: [] };
  surfaces.set(surface, created);
  return created;
}

// dead_click and field_abandoned refuse an absent or structural key: a structural collision
// would merge two controls and a structural fork would split one field, both over-counts (D-10).
// scroll_back alone takes a null key: replay/actions.ts resolves it with resolveIdentityAt, so
// its element is the scroll container rather than a control, and containers carry no identity.
function recordBeat(tally: SessionTally, beat: ObservedBeat, key: ElementKey | null): void {
  switch (beat.kind) {
    case "rage_click":
      if (key === null) return;
      tally.rageMax = Math.max(tally.rageMax, beat.clicks);
      return;
    case "dead_click":
      if (key === null || key.tier !== "stable") return;
      if (!isInteractive(beat.element)) return;
      tally.deadRepeats.set(key.key, (tally.deadRepeats.get(key.key) ?? NO_MAGNITUDE) + ONE_BEAT);
      return;
    case "field_abandoned":
      if (key === null || key.tier !== "stable") return;
      tally.abandonedKeys.add(key.key);
      return;
    case "field_refocus":
      if (key === null) return;
      tally.refocusMax = Math.max(tally.refocusMax, beat.focusCount);
      return;
    case "scroll_back":
      tally.scrollBacks += ONE_BEAT;
      return;
  }
}

function largest(values: readonly number[]): number {
  return values.reduce((highest, value) => Math.max(highest, value), NO_MAGNITUDE);
}

function magnitudeOf(tally: SessionTally, subkind: ObservedStruggleSubkind): number {
  switch (subkind) {
    case "rage_click":
      return tally.rageMax;
    case "dead_click":
      return largest([...tally.deadRepeats.values()]);
    case "field_abandoned":
      return tally.abandonedKeys.size;
    case "field_refocus":
      return tally.refocusMax;
    case "scroll_back":
      return tally.scrollBacks;
  }
}

function thresholdOf(ruleSet: ThresholdRuleSet, subkind: ObservedStruggleSubkind): number {
  switch (subkind) {
    case "rage_click":
      return ruleSet.struggleRageClickMin;
    case "dead_click":
      return ruleSet.struggleDeadClickMin;
    case "field_abandoned":
      return ruleSet.struggleFieldAbandonedMin;
    case "field_refocus":
      return ruleSet.struggleFieldRefocusMin;
    case "scroll_back":
      return ruleSet.struggleScrollBackMin;
  }
}

// Each action belongs to the surface named by the most recent preceding page action; one
// that no page action precedes, or whose href does not normalise, is dropped (D-11).
function tallySession(
  transcript: SessionTranscript,
  surfaces: Map<string, SurfaceAccumulator>,
): void {
  const visited = new Map<string, SessionTally>();
  let current: string | null = null;

  for (const action of transcript.actions) {
    if (action.kind === "page") {
      current = normaliseUrlPath(null, action.href);
      if (current !== null) tallyFor(visited, current);
      continue;
    }

    const beat = observedBeatOf(action);
    if (beat === null || current === null) continue;

    recordBeat(tallyFor(visited, current), beat, stableElementKey(beat.element));
  }

  for (const [surface, tally] of visited) {
    const accumulator = accumulatorFor(surfaces, surface);
    accumulator.reachedSessions += ONE_BEAT;
    accumulator.tallies.push(tally);
  }
}

function winningSubkind(
  tallies: readonly SessionTally[],
  ruleSet: ThresholdRuleSet,
): WinningSubkind | null {
  for (const subkind of SUBKINDS_BY_PRECEDENCE) {
    const threshold = thresholdOf(ruleSet, subkind);
    const qualifying = tallies
      .map((tally) => magnitudeOf(tally, subkind))
      .filter((magnitude) => magnitude >= threshold);

    if (qualifying.length === NO_MAGNITUDE) continue;
    if (qualifying.length < ruleSet.struggleObservedMinSessions) continue;

    return {
      subkind,
      attempts: largest(qualifying),
      qualifyingSessions: qualifying.length,
    };
  }

  return null;
}

// D-1: the producer gates. Below either floor the signal is never constructed, so no
// grade can move and no evidence shape can fork. D-3: exactly one signal per surface.
export function observedStruggleCandidates(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): readonly DetectorCandidate[] {
  const { kept, coverage } = analysedSessions(corpus);
  const keptIds = new Set(kept.map((session) => session.sessionId));

  const surfaces = new Map<string, SurfaceAccumulator>();
  // One session can arrive as several recording chunks. Only the first is tallied, so a
  // session is one reached session and one magnitude however many rows carry it.
  const tallied = new Set<string>();
  for (const replay of corpus.replays ?? []) {
    if (!keptIds.has(replay.sessionId)) continue;
    if (tallied.has(replay.sessionId)) continue;

    tallied.add(replay.sessionId);
    tallySession(replay.transcript, surfaces);
  }

  const candidates: DetectorCandidate[] = [];

  for (const [surface, accumulator] of surfaces) {
    const winner = winningSubkind(accumulator.tallies, ruleSet);
    if (winner === null) continue;

    const countOf = (numerator: number) =>
      measuredCount({
        numerator,
        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      });

    candidates.push({
      detector: "observed_struggle",
      claimedClass: "confusing",

      claimSubject: "surface",

      surface,
      // The surface came from a replay href, not from an event's declared normalisation.
      surfaceNormalisationVersion: null,
      signals: [
        {
          kind: "struggle",
          subkind: winner.subkind,
          surface,
          attempts: winner.attempts,

          strugglingSessions: countOf(winner.qualifyingSessions),
        },
      ],

      counts: [countOf(accumulator.reachedSessions), countOf(winner.qualifyingSessions)],
      timeframe: corpus.window,

      coverage,
    });
  }

  return candidates;
}
