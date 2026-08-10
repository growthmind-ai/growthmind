import type { ExclusionReason, ShippedCorpusKind } from "@growthmind/shared";
import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";

import type { CountBasis } from "../counts/measured-count";
import { buildSetAsideBreakdown } from "../counts/set-aside-breakdown";
import type { DetectorCorpus, SessionReplay, SessionTimeline } from "../detect/types";
import { deliverableName } from "../replay/describe-value";
import type { SessionAction, SessionTranscript } from "../replay/types";
import { surfaceNormalisationVersionOf } from "../spine/walk";
import { matchReplayPages, matchesSpineWalk, normalisedPageAddress } from "./page-match";

export type EligibleSession = {
  readonly session: SessionTimeline;

  // Whether this session can be shown to have used the change. An ambiguously-at-page session is
  // eligible and untouched: understating reach is the accepted error here.
  readonly touched: boolean;
};

export type PeopleTally = {
  readonly basis: CountBasis | null;
  readonly returned: number;
  readonly unidentified: number;
};

function isKept(session: SessionTimeline): boolean {
  return session.exclusionReason === "none";
}

function controlNameOf(action: SessionAction): string | null {
  if (!("element" in action)) return null;

  const name = action.element.accessibleName;
  return name === undefined ? null : deliverableName(name);
}

function namesControl(transcript: SessionTranscript, controlLabel: string): boolean {
  return transcript.actions.some((action) => controlNameOf(action) === controlLabel);
}

function eligibleOnSpine(
  sessions: readonly SessionTimeline[],
  page: string,
): readonly EligibleSession[] {
  return sessions
    .filter((session) => matchesSpineWalk(page, session))
    .map((session) => ({
      session,
      touched: surfaceNormalisationVersionOf([session], page) === URL_PATH_NORMALISATION_VERSION,
    }));
}

function eligibleOnRecordings(
  sessions: readonly SessionTimeline[],
  replays: readonly SessionReplay[],
  page: string,
  controlLabel: string,
): readonly EligibleSession[] {
  const byId = new Map(replays.map((replay) => [replay.sessionId, replay]));
  const eligible: EligibleSession[] = [];

  for (const session of sessions) {
    const replay = byId.get(session.sessionId);
    if (replay === undefined) continue;

    const match = matchReplayPages(page, replay.transcript.pages);
    const unreadable = replay.transcript.pages.some((href) => normalisedPageAddress(href) === null);
    if (!match.matched && !unreadable) continue;

    eligible.push({
      session,
      touched: match.matched && namesControl(replay.transcript, controlLabel),
    });
  }

  return eligible;
}

export function eligibleSessionsFor(
  corpus: DetectorCorpus,
  kind: ShippedCorpusKind,
  page: string,
  controlLabel: string,
): readonly EligibleSession[] {
  if (kind === "page") return eligibleOnSpine(corpus.sessions, page);

  return eligibleOnRecordings(corpus.sessions, corpus.replays ?? [], page, controlLabel);
}

export function rebuildBasis(sessions: readonly SessionTimeline[]): CountBasis {
  const kept = sessions.filter(isKept);

  const byReason = new Map<ExclusionReason, number>();
  for (const session of sessions) {
    if (isKept(session)) continue;
    byReason.set(session.exclusionReason, (byReason.get(session.exclusionReason) ?? 0) + 1);
  }

  return {
    totalInWindow: sessions.length,
    kept: kept.length,
    setAside: buildSetAsideBreakdown({ unit: "sessions", countsByReason: byReason }),
    keptUnchecked: kept.filter((session) => session.whoCountsUnchecked === true).length,
  };
}

// A corpus written before the per-session verdict existed reports its window total and no flags,
// which would silently recompute to zero and overstate how much of it we could check.
export function whoCountsIsReadable(corpus: DetectorCorpus): boolean {
  const recounted = corpus.sessions.filter(
    (session) => isKept(session) && session.whoCountsUnchecked === true,
  ).length;

  return recounted === corpus.basis.keptUnchecked;
}

type PersonGroup = {
  readonly kept: SessionTimeline[];
  readonly setAside: SessionTimeline[];
  touched: number;
};

// Each identity group lands in exactly one bucket, so the basis identity still holds in people.
// Sessions nobody can be told apart by are counted on their own and never folded into the
// majority: repeat use is precisely the claim they cannot support.
export function tallyPeople(eligible: readonly EligibleSession[]): PeopleTally {
  const groups = new Map<number, PersonGroup>();
  let unidentified = 0;

  for (const entry of eligible) {
    const group = entry.session.identityGroup;
    if (group === undefined || group === null) {
      if (isKept(entry.session)) unidentified += 1;
      continue;
    }

    const tally = groups.get(group) ?? { kept: [], setAside: [], touched: 0 };
    if (isKept(entry.session)) tally.kept.push(entry.session);
    else tally.setAside.push(entry.session);
    if (entry.touched && isKept(entry.session)) tally.touched += 1;
    groups.set(group, tally);
  }

  if (groups.size === 0) return { basis: null, returned: 0, unidentified };

  const byReason = new Map<ExclusionReason, number>();
  let kept = 0;
  let keptUnchecked = 0;
  let returned = 0;

  for (const tally of groups.values()) {
    const first = tally.setAside[0];
    if (tally.kept.length === 0 && first !== undefined) {
      const reason = first.exclusionReason;
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
      continue;
    }

    kept += 1;
    if (tally.kept.every((session) => session.whoCountsUnchecked === true)) keptUnchecked += 1;
    if (tally.touched > 1) returned += 1;
  }

  return {
    basis: {
      totalInWindow: groups.size,
      kept,
      setAside: buildSetAsideBreakdown({ unit: "sessions", countsByReason: byReason }),
      keptUnchecked,
    },
    returned,
    unidentified,
  };
}
