import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { isNormalisedUrlPath, normaliseUrlPath } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis, SetAsideBasis } from "../../src/counts/measured-count";
import { isMeasuredCount } from "../../src/counts/measured-count";
import { analysedSessions } from "../../src/detect/analysed";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorCorpus,
  SessionTimeline,
} from "../../src/detect/types";
import { confusingProofSatisfied } from "../../src/evidence/predicates";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { EVIDENCE_SHAPE_VERSION, evidenceShape } from "../../src/findings/evidence-shape";
import { unknownIdentity } from "../../src/replay/nodes";
import type {
  ElementIdentity,
  SessionAction,
  SessionTranscript,
  TranscriptCounts,
} from "../../src/replay/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

const SRC_DIR = `${import.meta.dir}/../../src`.replaceAll("\\", "/");

// TODO(O-041 T3.1/T3.3/T5.1): replace these test-local declarations and the deferred load
// with static imports of ObservedStruggleSubkind, SessionReplay and
// src/evidence/observed-struggle once those land. See .ai/adds/o-041-observed-struggle.md.
type ObservedStruggleSubkind =
  "rage_click" | "dead_click" | "field_abandoned" | "field_refocus" | "scroll_back";

const OBSERVED_SUBKINDS: readonly ObservedStruggleSubkind[] = [
  "rage_click",
  "dead_click",
  "field_abandoned",
  "field_refocus",
  "scroll_back",
];

type SessionReplay = {
  readonly sessionId: string;
  readonly transcript: SessionTranscript;
};

type ReplayCorpus = DetectorCorpus & {
  readonly replays?: readonly SessionReplay[];
};

type ObservedThresholdRuleSet = ThresholdRuleSet & {
  readonly struggleRageClickMin: number;
  readonly struggleDeadClickMin: number;
  readonly struggleFieldAbandonedMin: number;
  readonly struggleFieldRefocusMin: number;
  readonly struggleScrollBackMin: number;
  readonly struggleObservedMinSessions: number;
};

type ObservedStruggleModule = {
  readonly observedStruggleCandidates: (
    corpus: ReplayCorpus,
    ruleSet: ThresholdRuleSet,
  ) => readonly DetectorCandidate[];
  readonly OBSERVED_STRUGGLE_PRECEDENCE: Readonly<Record<ObservedStruggleSubkind, number>>;
};

const OBSERVED_STRUGGLE_SOURCE = `${SRC_DIR}/evidence/observed-struggle.ts`;
const ELEMENT_KEY_SOURCE = `${SRC_DIR}/evidence/element-key.ts`;

async function observedStruggleModule(): Promise<ObservedStruggleModule> {
  const loaded = (await import(OBSERVED_STRUGGLE_SOURCE)) as Partial<ObservedStruggleModule>;

  if (typeof loaded.observedStruggleCandidates !== "function") {
    throw new Error(
      "src/evidence/observed-struggle.ts must export observedStruggleCandidates(corpus, ruleSet)",
    );
  }
  if (loaded.OBSERVED_STRUGGLE_PRECEDENCE === undefined) {
    throw new Error("src/evidence/observed-struggle.ts must export OBSERVED_STRUGGLE_PRECEDENCE");
  }

  return loaded as ObservedStruggleModule;
}

function ruleSetV1(): ObservedThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules as ObservedThresholdRuleSet;
}

async function candidatesOf(corpus: ReplayCorpus): Promise<readonly DetectorCandidate[]> {
  const { observedStruggleCandidates } = await observedStruggleModule();
  return observedStruggleCandidates(corpus, ruleSetV1());
}

async function oneCandidate(corpus: ReplayCorpus): Promise<DetectorCandidate> {
  const candidates = await candidatesOf(corpus);
  expect(candidates.length).toBe(1);
  return candidates[0];
}

function winningSubkindOf(candidate: DetectorCandidate): string {
  expect(candidate.signals.length).toBe(1);
  return subkindOf(candidate.signals[0]);
}

function subkindOf(signal: EvidenceSignal): string {
  if (signal.kind !== "struggle") {
    throw new Error(
      `an observed struggle candidate carries struggle signals, never ${signal.kind}`,
    );
  }
  return signal.subkind;
}

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-08T00:00:00.000Z"),
};

const FIXTURE_STARTED_AT = new Date("2026-05-02T09:00:00.000Z");

const SURFACE = "/t041/checkout";
const SURFACE_HREF = `https://t041.example.invalid${SURFACE}`;
const UNNORMALISABLE_HREF = "t041 not a url";
const NON_FIXED_POINT_HREF = `https://t041.example.invalid${SURFACE}//`;

const ACTION_STEP_MS = 1_000;
const RAGE_SPAN_MS = 900;
const DROPPED_EVENTS = 7;

const NODE_ID_BASE = 1_000;
const NODE_ID_STRIDE = 100;

const EXTRA_SESSIONS_ON_SURFACE = 2;
const UNRESOLVED_NODE_ID = 7;

const PAY_CONTROL_TEST_ID = "t041-pay";
const BANNER_TEST_ID = "t041-banner";
const RERENDERED_FIELD_TEST_ID = "t041-card-number";
const STRUCTURAL_FIELD_CLASS = "t041-field";

const EXCLUDED_REASON: ExclusionReason = "automation_coding_agent";
const EXCLUDED_LABEL = "coding agent sessions";

const FIXTURE_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t041-connection",
    organizationId: "t041-org",
    projectId: "t041-project",
    sourceKind: "posthog",
    host: "https://t041.example.invalid",
    sourceProjectId: "t041-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: FIXTURE_WINDOW.end,
    watermarkAt: FIXTURE_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 60,
    connectedAt: FIXTURE_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

function nodeIdOf(session: number, slot: number): number {
  return NODE_ID_BASE + session * NODE_ID_STRIDE + slot;
}

function repeat<T>(count: number, build: (index: number) => T): readonly T[] {
  return Array.from({ length: count }, (_unused, index) => build(index));
}

function interactiveControl(nodeId: number, testId: string): ElementIdentity {
  return { nodeId, tagName: "button", classes: [], attributes: {}, testId };
}

function textField(nodeId: number, testId: string): ElementIdentity {
  return { nodeId, tagName: "input", classes: [], attributes: {}, testId };
}

function layoutContainer(nodeId: number, testId: string): ElementIdentity {
  return { nodeId, tagName: "div", classes: [], attributes: {}, testId };
}

function anonymousContainer(nodeId: number): ElementIdentity {
  return { nodeId, tagName: "div", classes: [], attributes: {} };
}

function structuralOnlyField(nodeId: number, className: string): ElementIdentity {
  return { nodeId, tagName: "input", classes: [className], attributes: {} };
}

type ActionAt = (atMs: number) => SessionAction;

function sequence(steps: readonly ActionAt[]): readonly SessionAction[] {
  return steps.map((step, index) => step((index + 1) * ACTION_STEP_MS));
}

function page(href: string): ActionAt {
  return (atMs) => ({ kind: "page", atMs, href });
}

function rageBurst(element: ElementIdentity, clicks: number): ActionAt {
  return (atMs) => ({ kind: "rage_click", atMs, element, clicks, spanMs: RAGE_SPAN_MS });
}

function deadPress(element: ElementIdentity): ActionAt {
  return (atMs) => ({ kind: "dead_click", atMs, element });
}

function fieldAbandoned(element: ElementIdentity): ActionAt {
  return (atMs) => ({ kind: "field_abandoned", atMs, element });
}

function fieldRefocus(element: ElementIdentity, focusCount: number): ActionAt {
  return (atMs) => ({ kind: "field_refocus", atMs, element, focusCount });
}

function scrollBack(element: ElementIdentity): ActionAt {
  return (atMs) => ({ kind: "scroll_back", atMs, element });
}

function countsOf(actions: readonly SessionAction[]): TranscriptCounts {
  const tally = (kind: SessionAction["kind"]): number =>
    actions.filter((action) => action.kind === kind).length;

  return {
    clicks: tally("click"),
    deadClicks: tally("dead_click"),
    rageClicks: tally("rage_click"),
    refocuses: tally("field_refocus"),
    abandonedFields: tally("field_abandoned"),
    scrollBacks: tally("scroll_back"),
  };
}

function transcriptOf(
  actions: readonly SessionAction[],
  startedAt: Date | null = FIXTURE_STARTED_AT,
  droppedEvents = 0,
): SessionTranscript {
  return {
    actions,
    startedAt,
    durationMs: actions.length * ACTION_STEP_MS,
    pages: actions.flatMap((action) => (action.kind === "page" ? [action.href] : [])),
    counts: countsOf(actions),
    droppedEvents,
    clockOriginAtMs: null,
  };
}

type ReplayFixture = {
  readonly sessionId: string;
  readonly transcript: SessionTranscript;
  readonly exclusionReason: ExclusionReason;
};

function replayOf(index: number, actions: readonly SessionAction[]): ReplayFixture {
  return {
    sessionId: `t041-session-${index}`,
    transcript: transcriptOf(actions),
    exclusionReason: "none",
  };
}

function sessionTimelineOf(replay: ReplayFixture): SessionTimeline {
  return {
    sessionId: replay.sessionId,
    startedAt: FIXTURE_WINDOW.start,
    exclusionReason: replay.exclusionReason,
    entryUrlPath: SURFACE,
    events: [],
  };
}

function basisOf(replays: readonly ReplayFixture[]): CountBasis {
  const kept = replays.filter((replay) => replay.exclusionReason === "none").length;
  const setAsideCount = replays.length - kept;
  const setAside: readonly SetAsideBasis[] =
    setAsideCount === 0
      ? []
      : [{ reason: EXCLUDED_REASON, count: setAsideCount, label: EXCLUDED_LABEL }];

  return { totalInWindow: replays.length, kept, setAside, keptUnchecked: 0 };
}

function corpusOf(replays: readonly ReplayFixture[]): ReplayCorpus {
  return {
    projectId: "t041-project",
    window: FIXTURE_WINDOW,
    connectionState: FIXTURE_CONNECTION_STATE,
    sessions: replays.map(sessionTimelineOf),
    basis: basisOf(replays),
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
    replays: replays.map((replay) => ({
      sessionId: replay.sessionId,
      transcript: replay.transcript,
    })),
  };
}

function corpusWithoutReplays(): ReplayCorpus {
  const replays = qualifyingRageReplays();
  return {
    projectId: "t041-project",
    window: FIXTURE_WINDOW,
    connectionState: FIXTURE_CONNECTION_STATE,
    sessions: replays.map(sessionTimelineOf),
    basis: basisOf(replays),
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

function mapTranscripts(
  corpus: ReplayCorpus,
  transform: (transcript: SessionTranscript) => SessionTranscript,
): ReplayCorpus {
  return {
    ...corpus,
    replays: (corpus.replays ?? []).map((replay) => ({
      sessionId: replay.sessionId,
      transcript: transform(replay.transcript),
    })),
  };
}

function rageActions(session: number, clicks: number): readonly SessionAction[] {
  return sequence([
    page(SURFACE_HREF),
    rageBurst(interactiveControl(nodeIdOf(session, 1), PAY_CONTROL_TEST_ID), clicks),
  ]);
}

function qualifyingRageReplays(): readonly ReplayFixture[] {
  const rules = ruleSetV1();

  const qualifying = repeat(rules.struggleObservedMinSessions, (session) =>
    replayOf(session, rageActions(session, rules.struggleRageClickMin)),
  );

  const onSurfaceBelowThreshold = repeat(EXTRA_SESSIONS_ON_SURFACE, (offset) => {
    const session = rules.struggleObservedMinSessions + offset;
    return replayOf(session, rageActions(session, rules.struggleRageClickMin - 1));
  });

  return [...qualifying, ...onSurfaceBelowThreshold];
}

function rageCorpus(): ReplayCorpus {
  return corpusOf(qualifyingRageReplays());
}

function deadClickCorpus(): ReplayCorpus {
  const rules = ruleSetV1();

  return corpusOf(
    repeat(rules.struggleObservedMinSessions, (session) =>
      replayOf(
        session,
        sequence([
          page(SURFACE_HREF),
          ...repeat(rules.struggleDeadClickMin, (press) =>
            deadPress(interactiveControl(nodeIdOf(session, press), PAY_CONTROL_TEST_ID)),
          ),
        ]),
      ),
    ),
  );
}

function fieldAbandonedCorpus(): ReplayCorpus {
  const rules = ruleSetV1();

  return corpusOf(
    repeat(rules.struggleObservedMinSessions, (session) =>
      replayOf(
        session,
        sequence([
          page(SURFACE_HREF),
          ...repeat(rules.struggleFieldAbandonedMin, (field) =>
            fieldAbandoned(textField(nodeIdOf(session, field), `t041-field-${field}`)),
          ),
        ]),
      ),
    ),
  );
}

function fieldRefocusCorpus(): ReplayCorpus {
  const rules = ruleSetV1();

  return corpusOf(
    repeat(rules.struggleObservedMinSessions, (session) =>
      replayOf(
        session,
        sequence([
          page(SURFACE_HREF),
          fieldRefocus(
            textField(nodeIdOf(session, 1), RERENDERED_FIELD_TEST_ID),
            rules.struggleFieldRefocusMin,
          ),
        ]),
      ),
    ),
  );
}

function scrollBackCorpus(): ReplayCorpus {
  const rules = ruleSetV1();

  return corpusOf(
    repeat(rules.struggleObservedMinSessions, (session) =>
      replayOf(
        session,
        sequence([
          page(SURFACE_HREF),
          ...repeat(rules.struggleScrollBackMin, (slot) =>
            scrollBack(layoutContainer(nodeIdOf(session, slot), BANNER_TEST_ID)),
          ),
        ]),
      ),
    ),
  );
}

function corpusForSubkind(subkind: ObservedStruggleSubkind): ReplayCorpus {
  switch (subkind) {
    case "rage_click":
      return rageCorpus();
    case "dead_click":
      return deadClickCorpus();
    case "field_abandoned":
      return fieldAbandonedCorpus();
    case "field_refocus":
      return fieldRefocusCorpus();
    case "scroll_back":
      return scrollBackCorpus();
  }
}

describe("OBSERVED_STRUGGLE_PRECEDENCE", () => {
  test("should rank every observed subkind exactly once in OBSERVED_STRUGGLE_PRECEDENCE", async () => {
    const { OBSERVED_STRUGGLE_PRECEDENCE } = await observedStruggleModule();
    const ranks = Object.values(OBSERVED_STRUGGLE_PRECEDENCE);

    expect(Object.keys(OBSERVED_STRUGGLE_PRECEDENCE).toSorted()).toEqual(
      [...OBSERVED_SUBKINDS].toSorted(),
    );
    expect(ranks.toSorted((left, right) => left - right)).toEqual(
      OBSERVED_SUBKINDS.map((_unused, rank) => rank),
    );
    expect(new Set(ranks).size).toBe(OBSERVED_SUBKINDS.length);
  });
});

describe("observedStruggleCandidates", () => {
  test("should emit one struggle signal per surface when two subkinds both clear", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            rageBurst(
              interactiveControl(nodeIdOf(session, 1), PAY_CONTROL_TEST_ID),
              rules.struggleRageClickMin,
            ),
            ...repeat(rules.struggleScrollBackMin, (slot) =>
              scrollBack(layoutContainer(nodeIdOf(session, slot), BANNER_TEST_ID)),
            ),
          ]),
        ),
      ),
    );

    const candidate = await oneCandidate(corpus);

    expect(candidate.signals.length).toBe(1);
    expect(winningSubkindOf(candidate)).toBe("rage_click");
  });

  test("should choose the winning subkind by OBSERVED_STRUGGLE_PRECEDENCE", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            ...repeat(rules.struggleFieldAbandonedMin, (field) =>
              fieldAbandoned(textField(nodeIdOf(session, field), `t041-field-${field}`)),
            ),
            ...repeat(rules.struggleDeadClickMin, (press) =>
              deadPress(interactiveControl(nodeIdOf(session, press), PAY_CONTROL_TEST_ID)),
            ),
          ]),
        ),
      ),
    );

    const candidate = await oneCandidate(corpus);

    expect(winningSubkindOf(candidate)).toBe("field_abandoned");
  });

  test("should not emit a candidate when no subkind clears its threshold", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            rageBurst(
              interactiveControl(nodeIdOf(session, 1), PAY_CONTROL_TEST_ID),
              rules.struggleRageClickMin - 1,
            ),
            ...repeat(rules.struggleDeadClickMin - 1, (press) =>
              deadPress(interactiveControl(nodeIdOf(session, press), PAY_CONTROL_TEST_ID)),
            ),
            ...repeat(rules.struggleFieldAbandonedMin - 1, (field) =>
              fieldAbandoned(textField(nodeIdOf(session, field), `t041-field-${field}`)),
            ),
            fieldRefocus(
              textField(nodeIdOf(session, 1), RERENDERED_FIELD_TEST_ID),
              rules.struggleFieldRefocusMin - 1,
            ),
            ...repeat(rules.struggleScrollBackMin - 1, (slot) =>
              scrollBack(layoutContainer(nodeIdOf(session, slot), BANNER_TEST_ID)),
            ),
          ]),
        ),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should not emit a candidate when a subkind clears its magnitude but not struggleObservedMinSessions", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions - 1, (session) =>
        replayOf(session, rageActions(session, rules.struggleRageClickMin)),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should not count a dead click on a non-interactive layout container", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            ...repeat(rules.struggleDeadClickMin, (press) =>
              deadPress(layoutContainer(nodeIdOf(session, press), BANNER_TEST_ID)),
            ),
          ]),
        ),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should count repeated dead clicks on an interactive control", async () => {
    const candidate = await oneCandidate(deadClickCorpus());

    expect(winningSubkindOf(candidate)).toBe("dead_click");
  });

  test("should not count an action whose node id never resolved", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            rageBurst(unknownIdentity(UNRESOLVED_NODE_ID), rules.struggleRageClickMin),
          ]),
        ),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should count the same beats when the node id resolves", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            rageBurst(
              layoutContainer(UNRESOLVED_NODE_ID, BANNER_TEST_ID),
              rules.struggleRageClickMin,
            ),
          ]),
        ),
      ),
    );

    const candidate = await oneCandidate(corpus);

    expect(winningSubkindOf(candidate)).toBe("rage_click");
  });

  test("should not count an action degraded to structural identity only", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            rageBurst(anonymousContainer(nodeIdOf(session, 1)), rules.struggleRageClickMin),
          ]),
        ),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should count the same beats when the element carries a testId", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            rageBurst(
              layoutContainer(nodeIdOf(session, 1), BANNER_TEST_ID),
              rules.struggleRageClickMin,
            ),
          ]),
        ),
      ),
    );

    const candidate = await oneCandidate(corpus);

    expect(winningSubkindOf(candidate)).toBe("rage_click");
  });

  test("should count one field re-rendered under two node ids as one abandoned field", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            ...repeat(rules.struggleFieldAbandonedMin, (render) =>
              fieldAbandoned(textField(nodeIdOf(session, render), RERENDERED_FIELD_TEST_ID)),
            ),
          ]),
        ),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should count two genuinely distinct fields as two abandoned fields", async () => {
    const candidate = await oneCandidate(fieldAbandonedCorpus());

    expect(winningSubkindOf(candidate)).toBe("field_abandoned");
  });

  test("should not count a field abandoned on an element with only a structural key", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(SURFACE_HREF),
            ...repeat(rules.struggleFieldAbandonedMin, (field) =>
              fieldAbandoned(
                structuralOnlyField(nodeIdOf(session, field), `${STRUCTURAL_FIELD_CLASS}-${field}`),
              ),
            ),
          ]),
        ),
      ),
    );

    expect((await candidatesOf(fieldAbandonedCorpus())).length).toBe(1);
    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should not count a session excluded from the analysed corpus", async () => {
    const kept = qualifyingRageReplays();
    const excluded = kept.map((replay) => ({ ...replay, exclusionReason: EXCLUDED_REASON }));

    const excludedCorpus = corpusOf(excluded);

    expect(analysedSessions(excludedCorpus).kept).toEqual([]);
    expect((await candidatesOf(corpusOf(kept))).length).toBe(1);
    expect(await candidatesOf(excludedCorpus)).toEqual([]);
  });

  test("should not emit when the corpus carries no replays", async () => {
    const empty: ReplayCorpus = { ...corpusWithoutReplays(), replays: [] };

    expect(await candidatesOf(corpusWithoutReplays())).toEqual([]);
    expect(await candidatesOf(empty)).toEqual([]);
  });

  test("should not emit for a transcript with zero actions", async () => {
    const rules = ruleSetV1();
    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) => replayOf(session, [])),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should not fail when a transcript carries a null startedAt", async () => {
    const corpus = mapTranscripts(rageCorpus(), (transcript) => ({
      ...transcript,
      startedAt: null,
    }));

    expect((corpus.replays ?? []).every((replay) => replay.transcript.startedAt === null)).toBe(
      true,
    );
    expect((await candidatesOf(corpus)).length).toBe(1);
  });

  test("should not fail when a transcript reports droppedEvents above zero", async () => {
    const corpus = mapTranscripts(rageCorpus(), (transcript) => ({
      ...transcript,
      droppedEvents: DROPPED_EVENTS,
    }));

    expect((await candidatesOf(corpus)).length).toBe(1);
  });

  test("should not attribute an action that no page action precedes", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            rageBurst(
              interactiveControl(nodeIdOf(session, 1), PAY_CONTROL_TEST_ID),
              rules.struggleRageClickMin,
            ),
            page(SURFACE_HREF),
          ]),
        ),
      ),
    );

    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should not attribute an action whose page href does not normalise", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(UNNORMALISABLE_HREF),
            rageBurst(
              interactiveControl(nodeIdOf(session, 1), PAY_CONTROL_TEST_ID),
              rules.struggleRageClickMin,
            ),
          ]),
        ),
      ),
    );

    expect(normaliseUrlPath(null, UNNORMALISABLE_HREF)).toBeNull();
    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should not attribute an action whose page href normalises to a non-fixed-point path", async () => {
    const rules = ruleSetV1();

    const corpus = corpusOf(
      repeat(rules.struggleObservedMinSessions, (session) =>
        replayOf(
          session,
          sequence([
            page(NON_FIXED_POINT_HREF),
            rageBurst(
              interactiveControl(nodeIdOf(session, 1), PAY_CONTROL_TEST_ID),
              rules.struggleRageClickMin,
            ),
          ]),
        ),
      ),
    );

    const normalised = normaliseUrlPath(null, NON_FIXED_POINT_HREF);
    expect(normalised).not.toBeNull();
    expect(isNormalisedUrlPath(normalised!)).toBe(false);
    expect(await candidatesOf(corpus)).toEqual([]);
  });

  test("should emit a candidate whose surface is already normalised", async () => {
    const candidate = await oneCandidate(rageCorpus());

    expect(() =>
      evidenceShape(
        {
          detector: candidate.detector,
          surface: candidate.surface,
          surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
          signals: candidate.signals,
          symptomClass: candidate.claimedClass,
        },
        EVIDENCE_SHAPE_VERSION,
      ),
    ).not.toThrow();
  });

  test("should emit strugglingSessions as a MeasuredCount built from the corpus basis", async () => {
    const rules = ruleSetV1();
    const corpus = rageCorpus();
    const candidate = await oneCandidate(corpus);
    const signal = candidate.signals[0] as EvidenceSignal;

    if (signal.kind !== "struggle") throw new Error("the emitted signal must be a struggle signal");

    expect(isMeasuredCount(signal.strugglingSessions)).toBe(true);
    expect(signal.strugglingSessions.numerator).toBe(rules.struggleObservedMinSessions);
    expect(signal.strugglingSessions.denominator).toBe(corpus.basis.kept);
    expect(signal.strugglingSessions.unit).toBe("sessions");
  });

  test("should emit counts whose first member is the sessions-on-surface count", async () => {
    const rules = ruleSetV1();
    const candidate = await oneCandidate(rageCorpus());

    expect(candidate.counts[0]?.numerator).toBe(
      rules.struggleObservedMinSessions + EXTRA_SESSIONS_ON_SURFACE,
    );
  });

  test("should emit surfaceNormalisationVersion as null on every observed candidate", async () => {
    const candidates = await candidatesOf(rageCorpus());

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.surfaceNormalisationVersion === null)).toBe(
      true,
    );
  });

  test("should emit only signals the proof predicate also satisfies", async () => {
    const rules = ruleSetV1();

    for (const subkind of OBSERVED_SUBKINDS) {
      const candidates = await candidatesOf(corpusForSubkind(subkind));

      expect(candidates.length).toBeGreaterThan(0);
      expect(
        candidates.every((candidate) => confusingProofSatisfied(candidate.signals, rules)),
      ).toBe(true);
    }
  });
});

describe("observed struggle module sources", () => {
  const AUTOCAPTURE = /autocapture/i;
  const VENDOR_CLICK_EVENT = /\$\s*(?:rageclick|rage_click|dead_?click|dead_?swipe)/i;

  test("should not reference a vendor click event name in any observed-struggle module", async () => {
    for (const path of [OBSERVED_STRUGGLE_SOURCE, ELEMENT_KEY_SOURCE]) {
      const source = await Bun.file(path).text();

      expect(source).not.toMatch(AUTOCAPTURE);
      expect(source).not.toMatch(VENDOR_CLICK_EVENT);
      expect(source).not.toContain("spanMs");
    }
  });

  test("should not import evidence or detect from any replay module", async () => {
    const replayDir = `${SRC_DIR}/replay`;
    const modules: string[] = [];
    for await (const entry of new Bun.Glob("**/*.ts").scan({ cwd: replayDir })) {
      modules.push(entry.replaceAll("\\", "/"));
    }

    expect(modules.length).toBeGreaterThan(0);

    for (const name of modules) {
      const source = await Bun.file(`${replayDir}/${name}`).text();

      expect(source).not.toMatch(/from\s+["']\.\.\/evidence/);
      expect(source).not.toMatch(/from\s+["']\.\.\/detect/);
    }
  });
});
