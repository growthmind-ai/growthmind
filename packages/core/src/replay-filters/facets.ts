import { REPLAY_LANES, groupSessionsByDomain, recordingIdFromSessionKey } from "@growthmind/shared";
import type { ReplaySessionFact } from "@growthmind/shared";

import { laneOf } from "./lanes";

export interface FacetInput {
  // Built before the other filters are applied: this is the array the option rows come from.
  readonly universe: readonly ReplaySessionFact[];

  // Built after: this is the array the counts come from.
  readonly conditioned: readonly ReplaySessionFact[];
}

export interface FacetOption {
  readonly value: string;
  readonly sessionCount: number;
  readonly replayCount: number;
}

export type FacetAccessor = (session: ReplaySessionFact) => string | null;

export type FacetUniverse = (sessions: readonly ReplaySessionFact[]) => readonly string[];

export type ReplayFacet = (input: FacetInput) => readonly FacetOption[];

// An option whose count is zero is the whole point of the split: it survives, reading 0, rather
// than vanishing because the conditioned set happens not to contain it.
function countOption(
  value: string,
  conditioned: readonly ReplaySessionFact[],
  accessor: FacetAccessor,
): FacetOption {
  let sessionCount = 0;
  let replayCount = 0;

  for (const session of conditioned) {
    if (accessor(session) !== value) continue;
    sessionCount += 1;
    if (recordingIdFromSessionKey(session.sessionKey) !== null) replayCount += 1;
  }

  return { value, sessionCount, replayCount };
}

// A null accessor value puts the session in no bucket and creates no option row.
function valuesByRecency(accessor: FacetAccessor): FacetUniverse {
  return (sessions) => {
    const mostRecent = new Map<string, Date>();

    for (const session of sessions) {
      const value = accessor(session);
      if (value === null) continue;

      const seen = mostRecent.get(value);
      if (seen === undefined || session.startedAt > seen) mostRecent.set(value, session.startedAt);
    }

    return [...mostRecent.entries()]
      .toSorted(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([value]) => value);
  };
}

export function listFacet(
  accessor: FacetAccessor,
  universeOf: FacetUniverse = valuesByRecency(accessor),
): ReplayFacet {
  return ({ universe, conditioned }) =>
    universeOf(universe).map((value) => countOption(value, conditioned, accessor));
}

const companyOf: FacetAccessor = (session) => session.identityEmailDomain;

// The company universe is groupSessionsByDomain's, so the free-mail skip that keeps "personal
// addresses aren't companies" true is enforced in one place for the whole product.
const companyDomains: FacetUniverse = (sessions) =>
  groupSessionsByDomain(
    sessions.flatMap((session) =>
      session.identityEmailDomain === null
        ? []
        : [{ identityEmailDomain: session.identityEmailDomain, startedAt: session.startedAt }],
    ),
  ).map((group) => group.domain);

export const companyFacet: ReplayFacet = listFacet(companyOf, companyDomains);

export const entryFacet: ReplayFacet = listFacet((session) => session.entryUrlPath);

// The three lanes are the universe whatever the read contains, so an empty lane still offers
// its option rather than disappearing from the panel.
export const laneFacet: ReplayFacet = listFacet(laneOf, () => REPLAY_LANES);
