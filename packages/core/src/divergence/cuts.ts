import {
  BROWSER_FAMILIES,
  DEVICE_TYPES,
  SURFACE_COHORT_CUT,
  browserCut,
  deviceCut,
} from "@growthmind/shared";
import type { CohortCut, SessionCohortCuts } from "@growthmind/shared";

import type { SessionTimeline } from "../detect/types";

export type DivergenceCohortCut = {
  readonly cut: CohortCut;
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
};

// A session whose user agent was never readable is unknown on both axes rather than absent from
// either, so each axis stays a total partition of the cohort.
const UNKNOWN_CUTS: SessionCohortCuts = { browser: "unknown", device: "unknown" };

function cutsOf(session: SessionTimeline): SessionCohortCuts {
  return session.cohortCuts ?? UNKNOWN_CUTS;
}

function bucketsOf<Key extends string>(
  sessions: readonly SessionTimeline[],
  keyOf: (cuts: SessionCohortCuts) => Key,
): Map<Key, SessionTimeline[]> {
  const buckets = new Map<Key, SessionTimeline[]>();
  for (const session of sessions) {
    const key = keyOf(cutsOf(session));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(session);
      continue;
    }
    buckets.set(key, [session]);
  }
  return buckets;
}

function axisCuts<Key extends string>(
  order: readonly Key[],
  cutOf: (key: Key) => CohortCut,
  succeeded: ReadonlyMap<Key, SessionTimeline[]>,
  failed: ReadonlyMap<Key, SessionTimeline[]>,
): readonly DivergenceCohortCut[] {
  const cuts: DivergenceCohortCut[] = [];
  for (const key of order) {
    const keySucceeded = succeeded.get(key);
    const keyFailed = failed.get(key);
    if (!keySucceeded && !keyFailed) continue;
    cuts.push({ cut: cutOf(key), succeeded: keySucceeded ?? [], failed: keyFailed ?? [] });
  }
  return cuts;
}

export function cohortCutsOf(cohort: {
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
}): readonly DivergenceCohortCut[] {
  const { succeeded, failed } = cohort;

  return [
    // The caller's own array references, not copies: the surface-level computation being unchanged
    // is then a structural fact rather than an assertion.
    { cut: SURFACE_COHORT_CUT, succeeded, failed },
    ...axisCuts(
      BROWSER_FAMILIES,
      browserCut,
      bucketsOf(succeeded, (cuts) => cuts.browser),
      bucketsOf(failed, (cuts) => cuts.browser),
    ),
    ...axisCuts(
      DEVICE_TYPES,
      deviceCut,
      bucketsOf(succeeded, (cuts) => cuts.device),
      bucketsOf(failed, (cuts) => cuts.device),
    ),
  ];
}
