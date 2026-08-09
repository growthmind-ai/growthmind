import type { ConnectionState, ExclusionReason } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS, URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";

import type { SetAsideBasis } from "../../src/counts/measured-count";
import type {
  DetectorCorpus,
  SessionReplay,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import type { ElementIdentity, SessionAction, SessionTranscript } from "../../src/replay/types";
import type { BuildAtPageCorpusInput } from "../../src/shipped/corpus";

export const PROJECT_ID = "prj-o053-report-shipped";

export const SHIPPED_PAGE = "/t053/reports";
export const OTHER_PAGE = "/t053/home";

// What a replay stores for the same navigation: the whole URL, origin and query intact, in the
// developer's own casing. Decision 0 is the join that makes these two comparable.
export const SHIPPED_PAGE_HREF = "https://app.example.test/T053/Reports?utm=x";
export const OTHER_PAGE_HREF = "https://app.example.test/T053/Home";

export const CONTROL_LABEL = "Export CSV";

// The whole page is the change, so there is no control label. Decision 3a's sentinel.
export const PAGE_LEVEL_CONTROL_LABEL = "";

export const WINDOW_START = new Date("2026-08-01T00:00:00.000Z");
export const WINDOW_END = new Date("2026-08-15T00:00:00.000Z");
export const SHIPPED_WINDOW = { start: WINDOW_START, end: WINDOW_END } as const;

export const NOT_CONNECTED: ConnectionState = { status: "not_connected" };

const EVENT_STRIDE_MS = 1_000;

export type ShippedCorpusKindName = "page" | "recorded";

function eventsOf(
  sessionId: string,
  paths: readonly (string | null)[],
  normalisationVersion: number | null,
): readonly TimelineEvent[] {
  return paths.map((urlPath, index) => ({
    sourceEventId: `${sessionId}-e${String(index)}`,
    name: "$pageview",
    occurredAt: new Date(WINDOW_START.getTime() + index * EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: urlPath === null ? null : normalisationVersion,
  }));
}

export function labelledElement(nodeId: number, accessibleName: string): ElementIdentity {
  return {
    nodeId,
    tagName: "BUTTON",
    classes: ["m_77c9d27d"],
    accessibleName,
    attributes: {},
  };
}

// A control a person could not name from the recording: a hash class and nothing else, which is
// what describeElement falls back to. It can never equal a reported control label.
export function unlabelledElement(nodeId: number): ElementIdentity {
  return {
    nodeId,
    tagName: "BUTTON",
    classes: ["m_0f1c2d3e"],
    attributes: {},
  };
}

export function pageBeat(href: string, atMs = 0): SessionAction {
  return { kind: "page", atMs, href };
}

export function controlClick(atMs = 1_000, label = CONTROL_LABEL): SessionAction {
  return { kind: "click", atMs, element: labelledElement(21, label) };
}

export function unlabelledClick(atMs = 1_000): SessionAction {
  return { kind: "click", atMs, element: unlabelledElement(22) };
}

export function transcriptOf(
  pages: readonly string[],
  actions: readonly SessionAction[],
): SessionTranscript {
  const clicks = actions.filter((action) => action.kind === "click").length;

  return {
    actions,
    startedAt: WINDOW_START,
    clockOriginAtMs: 0,
    durationMs: 60_000,
    pages,
    counts: {
      clicks,
      deadClicks: 0,
      rageClicks: 0,
      refocuses: 0,
      abandonedFields: 0,
      scrollBacks: 0,
    },
    droppedEvents: 0,
  };
}

export type ShippedSessionSpec = {
  readonly id: string;

  readonly atPage?: boolean;

  readonly paths?: readonly (string | null)[];

  readonly exclusionReason?: ExclusionReason;

  // `undefined` leaves the field off the session entirely, which is how a corpus written before
  // the flag existed looks (Decision 2b).
  readonly whoCountsUnchecked?: boolean;

  readonly identityGroup?: number | null;

  readonly carryIdentityGroup?: boolean;

  readonly normalisationVersion?: number | null;
};

export function shippedSession(spec: ShippedSessionSpec): SessionTimeline {
  const paths = spec.paths ?? (spec.atPage === false ? [OTHER_PAGE] : [OTHER_PAGE, SHIPPED_PAGE]);
  const version =
    spec.normalisationVersion === undefined
      ? URL_PATH_NORMALISATION_VERSION
      : spec.normalisationVersion;

  const base = {
    sessionId: spec.id,
    startedAt: WINDOW_START,
    exclusionReason: spec.exclusionReason ?? "none",
    entryUrlPath: paths[0] ?? null,
    events: eventsOf(spec.id, paths, version),
  } satisfies SessionTimeline;

  const withFlag =
    spec.whoCountsUnchecked === undefined
      ? base
      : { ...base, whoCountsUnchecked: spec.whoCountsUnchecked };

  if (spec.carryIdentityGroup === false) return withFlag;

  return { ...withFlag, identityGroup: spec.identityGroup ?? null };
}

export type ShippedReplaySpec = {
  readonly sessionId: string;

  readonly pages?: readonly string[];

  readonly touched?: boolean;

  readonly touchedUnlabelled?: boolean;

  readonly controlLabel?: string;
};

export function shippedReplay(spec: ShippedReplaySpec): SessionReplay {
  const pages = spec.pages ?? [SHIPPED_PAGE_HREF];
  const actions: SessionAction[] = pages.map((href, index) => pageBeat(href, index * 100));

  if (spec.touched === true) actions.push(controlClick(1_000, spec.controlLabel ?? CONTROL_LABEL));
  if (spec.touchedUnlabelled === true) actions.push(unlabelledClick(1_100));

  return { sessionId: spec.sessionId, transcript: transcriptOf(pages, actions) };
}

// A replay row that exists and recorded nothing: `actions: []` with the page still named. The D5
// sibling of "no replay row at all", which is unrecorded and not eligible.
export function emptyReplay(sessionId: string, pages: readonly string[]): SessionReplay {
  return { sessionId, transcript: transcriptOf(pages, []) };
}

function setAsideOf(counts: ReadonlyMap<ExclusionReason, number>): readonly SetAsideBasis[] {
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({ reason, count, label: EXCLUSION_REASON_LABELS[reason] }))
    .toSorted((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

export type CorpusOfSessionsSpec = {
  readonly sessions: readonly SessionTimeline[];
  readonly replays?: readonly SessionReplay[];
  readonly truncated?: boolean;

  // Overrides the count derived from the sessions, so a corpus can claim an aggregate its
  // per-session flags cannot account for.
  readonly keptUnchecked?: number;
};

export function corpusOfSessions(spec: CorpusOfSessionsSpec): DetectorCorpus {
  const kept = spec.sessions.filter((session) => session.exclusionReason === "none");

  const byReason = new Map<ExclusionReason, number>();
  for (const session of spec.sessions) {
    if (session.exclusionReason === "none") continue;
    byReason.set(session.exclusionReason, (byReason.get(session.exclusionReason) ?? 0) + 1);
  }

  const derivedUnchecked = kept.filter((session) => session.whoCountsUnchecked === true).length;

  return {
    projectId: PROJECT_ID,
    window: { start: WINDOW_START, end: WINDOW_END },
    connectionState: NOT_CONNECTED,
    sessions: spec.sessions,
    ...(spec.replays === undefined ? {} : { replays: spec.replays }),
    basis: {
      totalInWindow: spec.sessions.length,
      kept: kept.length,
      setAside: setAsideOf(byReason),
      keptUnchecked: spec.keptUnchecked ?? derivedUnchecked,
    },
    coverage: { truncated: spec.truncated ?? false, eventsWithoutUrlPath: 0 },
  };
}

export type ShippedCorpusSpec = {
  // Every session in the window, at the page or not.
  readonly totalSessions: number;

  // How many of them reached the page.
  readonly atPage: number;

  // How many of the at-page sessions are set aside. Kept at-page sessions are generated first,
  // so `recordedAtPage` and `touchedAtPage` land on kept sessions.
  readonly excludedAtPage?: number;
  readonly excludedAtPageReason?: ExclusionReason;

  readonly excludedOffPage?: number;
  readonly excludedOffPageReason?: ExclusionReason;

  readonly uncheckedAtPageKept?: number;
  readonly uncheckedOffPageKept?: number;

  // `false` leaves whoCountsUnchecked off every session, which is a corpus that predates it.
  readonly carryWhoCountsFlag?: boolean;

  readonly keptUnchecked?: number;

  // Cycled across the at-page sessions in order. `null` is a session nobody can be told apart by.
  readonly identityGroups?: readonly (number | null)[];
  readonly carryIdentityGroup?: boolean;

  readonly recordedAtPage?: number;
  readonly touchedAtPage?: number;
  readonly recordedPages?: readonly string[];

  readonly truncated?: boolean;

  readonly normalisationVersion?: number | null;
};

export function shippedCorpus(spec: ShippedCorpusSpec): DetectorCorpus {
  const excludedAtPage = spec.excludedAtPage ?? 0;
  const excludedOffPage = spec.excludedOffPage ?? 0;
  const keptAtPage = spec.atPage - excludedAtPage;
  const offPage = spec.totalSessions - spec.atPage;
  const keptOffPage = offPage - excludedOffPage;
  const carryFlag = spec.carryWhoCountsFlag ?? true;
  const groups = spec.identityGroups;

  const identityFor = (index: number): number | null => {
    if (groups === undefined) return index;
    return groups[index % groups.length] ?? null;
  };

  const uncheckedAtPage = spec.uncheckedAtPageKept ?? 0;
  const uncheckedOffPage = spec.uncheckedOffPageKept ?? 0;

  const shared = {
    ...(spec.carryIdentityGroup === undefined
      ? {}
      : { carryIdentityGroup: spec.carryIdentityGroup }),
    ...(spec.normalisationVersion === undefined
      ? {}
      : { normalisationVersion: spec.normalisationVersion }),
  };

  const sessions: SessionTimeline[] = [];
  const replays: SessionReplay[] = [];

  for (let index = 0; index < spec.atPage; index += 1) {
    const kept = index < keptAtPage;
    sessions.push(
      shippedSession({
        ...shared,
        id: `at-${String(index)}`,
        atPage: true,
        exclusionReason: kept ? "none" : (spec.excludedAtPageReason ?? "internal_domain"),
        ...(carryFlag ? { whoCountsUnchecked: kept && index < uncheckedAtPage } : {}),
        identityGroup: identityFor(index),
      }),
    );

    if (index < (spec.recordedAtPage ?? 0)) {
      replays.push(
        shippedReplay({
          sessionId: `at-${String(index)}`,
          pages: spec.recordedPages ?? [SHIPPED_PAGE_HREF],
          touched: index < (spec.touchedAtPage ?? 0),
        }),
      );
    }
  }

  for (let index = 0; index < offPage; index += 1) {
    const kept = index < keptOffPage;
    sessions.push(
      shippedSession({
        ...shared,
        id: `off-${String(index)}`,
        atPage: false,
        exclusionReason: kept ? "none" : (spec.excludedOffPageReason ?? "automation_headless"),
        ...(carryFlag ? { whoCountsUnchecked: kept && index < uncheckedOffPage } : {}),
        identityGroup: null,
      }),
    );
  }

  return corpusOfSessions({
    sessions,
    ...(replays.length > 0 ? { replays } : {}),
    ...(spec.truncated === undefined ? {} : { truncated: spec.truncated }),
    ...(spec.keptUnchecked === undefined ? {} : { keptUnchecked: spec.keptUnchecked }),
  });
}

export type AtPageInputOverrides = {
  readonly kind?: ShippedCorpusKindName;
  readonly page?: string;
  readonly controlLabel?: string;
  readonly pageNormalisationVersion?: number;
};

export function atPageInput(
  corpus: DetectorCorpus,
  overrides: AtPageInputOverrides = {},
): BuildAtPageCorpusInput {
  const kind = overrides.kind ?? "page";

  return {
    corpus,
    kind,
    page: overrides.page ?? SHIPPED_PAGE,
    controlLabel:
      overrides.controlLabel ?? (kind === "page" ? PAGE_LEVEL_CONTROL_LABEL : CONTROL_LABEL),
    pageNormalisationVersion:
      overrides.pageNormalisationVersion ?? URL_PATH_NORMALISATION_VERSION,
  };
}

export type BuildOutcome<TCorpus> =
  | { readonly ok: true; readonly corpus: TCorpus }
  | { readonly ok: false; readonly reason: string };

export function mustBuild<TCorpus>(result: BuildOutcome<TCorpus>): TCorpus {
  if (!result.ok) {
    throw new Error(`expected an at-page corpus, got a refusal: ${result.reason}`);
  }
  return result.corpus;
}
