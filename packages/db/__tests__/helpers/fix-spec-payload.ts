// The persisted side of R-1: plain JSON, no `MeasuredCount` brand and no `Date`, because
// that is what survives a jsonb round trip. `rehydrateFixSpecInput` re-mints both.
import { FIX_SPEC_PAYLOAD_VERSION, traceEntry, type FixSpecPayload } from "@growthmind/core";

import type { MeasuredCountRow } from "../../src/repositories/findings.repo";

export const PAYLOAD_WINDOW_START = "2026-07-24T00:00:00.000Z";

export const PAYLOAD_WINDOW_END = "2026-07-31T00:00:00.000Z";

// Deliberately not a checkout or pricing path: those are refused by the §5 deny list
// before a payload is ever read, so every test here would assert on the refusal instead of
// the thing it is about. `FORBIDDEN_SURFACE` is what exercises that gate.
export const RENDERABLE_SURFACE = "/projects/reports";

// Neither rooted nor free of its trailing slash, so `renderFixSpec` refuses it at the mint.
export const UNRENDERABLE_SURFACE = "projects/reports/";

export const FORBIDDEN_SURFACE = "/checkout/payment";

const SET_ASIDE_COUNT = 2;

function persistedCount(numerator: number, denominator: number): unknown {
  return {
    numerator,
    denominator,
    unit: "sessions",
    timeframe: { start: PAYLOAD_WINDOW_START, end: PAYLOAD_WINDOW_END },
    basis: {
      totalInWindow: denominator + SET_ASIDE_COUNT,
      kept: denominator,
      keptUnchecked: 0,
      setAside: [
        { reason: "internal_domain", count: SET_ASIDE_COUNT, label: "Your own team's visits" },
      ],
    },
  };
}

export interface FixSpecPayloadOverrides {
  readonly surface?: string;

  // The impact count `listOpen` ranks on. Overridden only by tests about that ranking.
  readonly affected?: number | undefined;
}

export function fixSpecPayload(overrides: FixSpecPayloadOverrides = {}): FixSpecPayload {
  const surface = overrides.surface ?? RENDERABLE_SURFACE;
  const affected = overrides.affected ?? 19;

  return {
    payloadVersion: FIX_SPEC_PAYLOAD_VERSION,

    candidate: {
      detector: "funnel_dropoff",
      claimedClass: "confusing",
      finalClass: "confusing",
      trace: [
        traceEntry({
          class: "confusing",
          predicate: "confusing_proof_v1",
          predicateVersion: 1,
          satisfied: true,
        }),
      ],

      counts: [persistedCount(28, 28), persistedCount(affected, 28)],
      timeframe: { start: PAYLOAD_WINDOW_START, end: PAYLOAD_WINDOW_END },
      claimSubject: "surface",
      surface,
      surfaceNormalisationVersion: 1,
      evidenceShape: `funnel_dropoff:surface=${surface}`,
      evidenceShapeVersion: 1,
      thresholdRuleSetVersion: 1,
      ranking: { sampleSize: persistedCount(28, 28), confidenceBasis: "threshold_met" },
      coverage: { truncated: false, eventsWithoutUrlPath: 0 },
    },

    signals: [
      {
        kind: "struggle",
        subkind: "repeated_attempt",
        surface,
        attempts: 3,
        strugglingSessions: persistedCount(11, 28),
      },
    ],
  };
}

export function findingCountRow(numerator: number, denominator: number): MeasuredCountRow {
  return {
    numerator,
    denominator,
    unit: "sessions",
    timeframe: { start: new Date(PAYLOAD_WINDOW_START), end: new Date(PAYLOAD_WINDOW_END) },
    basis: {
      totalInWindow: denominator + SET_ASIDE_COUNT,
      kept: denominator,
      keptUnchecked: 0,
      setAside: [
        { reason: "internal_domain", count: SET_ASIDE_COUNT, label: "Your own team's visits" },
      ],
    },
  };
}
