import { measuredCount } from "../counts/measured-count";
import type { EvidenceSignal } from "../evidence/signals";
import type { DetectorName, DetectorProposedClass, ThresholdRuleSet } from "../rules/types";
import { analysedSessions } from "./analysed";
import { orderTimeline } from "./order";
import type {
  DetectorCandidate,
  DetectorCorpus,
  DetectorCoverage,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "./types";

const DETECTOR: DetectorName = "error_event";

const CLAIMED_CLASS: DetectorProposedClass = "broken";

type SurfaceGroup = {
  readonly signals: DraftSignal[];

  readonly sessionIds: Set<string>;

  readonly correlatedSessionIds: Set<string>;
  readonly normalisationVersions: Set<number | null>;
};

function attributionOf(
  exception: TimelineEvent,
  precedingAction: TimelineEvent | null,
): { readonly surface: string; readonly normalisationVersion: number | null } | null {
  if (exception.urlPath !== null) {
    return {
      surface: exception.urlPath,
      normalisationVersion: exception.urlPathNormalisationVersion,
    };
  }

  if (precedingAction !== null && precedingAction.urlPath !== null) {
    return {
      surface: precedingAction.urlPath,
      normalisationVersion: precedingAction.urlPathNormalisationVersion,
    };
  }

  return null;
}

type DraftSignal =
  | Omit<Extract<EvidenceSignal, { kind: "failure_correlated" }>, "correlatedSessions">
  | Extract<EvidenceSignal, { kind: "failure_uncorrelated" }>;

function signalFor(
  exception: TimelineEvent,
  precedingAction: TimelineEvent | null,
  ruleSet: ThresholdRuleSet,
): DraftSignal {
  if (
    precedingAction !== null &&
    exception.occurredAt.getTime() - precedingAction.occurredAt.getTime() <=
      ruleSet.errorCorrelationWindowMs
  ) {
    return {
      kind: "failure_correlated",
      eventName: exception.name,
      occurredAt: exception.occurredAt,
      precedingActionName: precedingAction.name,
      correlationWindowMs: ruleSet.errorCorrelationWindowMs,
    };
  }

  return {
    kind: "failure_uncorrelated",
    eventName: exception.name,
    occurredAt: exception.occurredAt,
  };
}

function isPassiveEvent(event: TimelineEvent, ruleSet: ThresholdRuleSet): boolean {
  if (ruleSet.passiveEventNames.includes(event.name)) return true;

  if (event.name.startsWith(ruleSet.vendorEventPrefix)) {
    return !ruleSet.userInitiatedVendorEvents.includes(event.name);
  }

  return false;
}

function collectSession(
  session: SessionTimeline,
  ruleSet: ThresholdRuleSet,
  groups: Map<string, SurfaceGroup>,
): void {
  let precedingAction: TimelineEvent | null = null;

  for (const event of orderTimeline(session.events)) {
    if (event.name !== ruleSet.exceptionEventName) {
      precedingAction = isPassiveEvent(event, ruleSet) ? null : event;
      continue;
    }

    const attribution = attributionOf(event, precedingAction);
    if (attribution === null) {
      continue;
    }

    const group: SurfaceGroup = groups.get(attribution.surface) ?? {
      signals: [],
      sessionIds: new Set<string>(),
      correlatedSessionIds: new Set<string>(),
      normalisationVersions: new Set<number | null>(),
    };
    groups.set(attribution.surface, group);

    const draft = signalFor(event, precedingAction, ruleSet);
    group.signals.push(draft);
    group.sessionIds.add(session.sessionId);

    if (draft.kind === "failure_correlated") {
      group.correlatedSessionIds.add(session.sessionId);
    }
    group.normalisationVersions.add(attribution.normalisationVersion);
  }
}

function unanimousVersion(versions: ReadonlySet<number | null>): number | null {
  const observed = [...versions];
  const [first] = observed;

  return observed.every((version) => version === first) ? (first ?? null) : null;
}

function countOf(numerator: number, corpus: DetectorCorpus) {
  return measuredCount({
    numerator,
    denominator: corpus.basis.kept,
    unit: "sessions",
    timeframe: corpus.window,
    basis: corpus.basis,
  });
}

function candidateOf(
  surface: string,
  group: SurfaceGroup,
  corpus: DetectorCorpus,
  coverage: DetectorCoverage,
): DetectorCandidate {
  return {
    detector: DETECTOR,
    claimedClass: CLAIMED_CLASS,

    claimSubject: "surface",
    surface,
    surfaceNormalisationVersion: unanimousVersion(group.normalisationVersions),
    signals: group.signals.map((draft) =>
      draft.kind === "failure_correlated"
        ? { ...draft, correlatedSessions: countOf(group.correlatedSessionIds.size, corpus) }
        : draft,
    ),

    counts: [
      measuredCount({
        numerator: group.sessionIds.size,
        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      }),
    ],
    timeframe: corpus.window,
    coverage,
  };
}

export function detectErrorEvent(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  const { kept, coverage } = analysedSessions(corpus);

  const groups = new Map<string, SurfaceGroup>();
  for (const session of kept) {
    collectSession(session, ruleSet, groups);
  }

  const candidates = [...groups.entries()]
    // Inclusive: it fires AT `errorMinAffectedSessions`, not one above.
    .filter(([, group]) => group.sessionIds.size >= ruleSet.errorMinAffectedSessions)
    .map(([surface, group]) => candidateOf(surface, group, corpus, coverage));

  return {
    detector: DETECTOR,

    connectionState: corpus.connectionState,
    coverage,
    candidates,
  };
}
