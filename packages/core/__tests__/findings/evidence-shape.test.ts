import { URL_PATH_NORMALISATION_VERSION, normaliseUrlPath } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import type { EvidenceSignal } from "../../src/evidence/signals";
import {
  EVIDENCE_SHAPE_SERIALISERS,
  EVIDENCE_SHAPE_VERSION,
  evidenceShape,
} from "../../src/findings/evidence-shape";
import type { EvidenceShapeInput } from "../../src/findings/evidence-shape";

const FIRST_EXCEPTION_AT = new Date("2026-06-01T10:00:00.000Z");

const LATER_EXCEPTION_AT = new Date("2026-07-13T22:45:31.000Z");

function normalisedSurface(rawPathname: string): string {
  const surface = normaliseUrlPath(rawPathname, null);
  if (surface === null) {
    throw new Error(`fixture pathname must normalise to a surface: ${rawPathname}`);
  }
  return surface;
}

function correlatedFailure(overrides: { readonly occurredAt?: Date } = {}): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: "$exception",
    occurredAt: overrides.occurredAt ?? FIRST_EXCEPTION_AT,
    precedingActionName: "save_clicked",
    correlationWindowMs: 30_000,
    correlatedSessions: measuredCount({
      numerator: 3,
      denominator: 10,
      unit: "sessions",
      timeframe: { start: FIRST_EXCEPTION_AT, end: LATER_EXCEPTION_AT },
      basis: { totalInWindow: 10, kept: 10, setAside: [] },
    }),
  };
}

function struggleSignal(input: {
  readonly subkind: "repeated_attempt" | "backtrack";
  readonly surface: string;
  readonly attempts: number;
  readonly strugglingSessions: number;
  readonly kept: number;
}): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: input.subkind,
    surface: input.surface,
    attempts: input.attempts,
    strugglingSessions: measuredCount({
      numerator: input.strugglingSessions,
      denominator: input.kept,
      unit: "sessions",
      timeframe: { start: FIRST_EXCEPTION_AT, end: LATER_EXCEPTION_AT },
      basis: { totalInWindow: input.kept, kept: input.kept, setAside: [] },
    }),
  };
}

type InputWithIgnoredFields = EvidenceShapeInput & { readonly [ignored: string]: unknown };

const GOLDEN_V1 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_correlated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":2,"symptomClass":"broken","v":1}';

function withSurface(surface: string): EvidenceShapeInput {
  return {
    detector: "funnel_dropoff",
    surface,
    surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
    signals: [
      struggleSignal({
        subkind: "repeated_attempt",
        surface,
        attempts: 3,
        strugglingSessions: 3,
        kept: 10,
      }),
    ],
    symptomClass: "confusing",
  };
}

describe("evidenceShape — identity across a churn event", () => {
  test("should serialise identically across a churn event: re-ordered payload, differently-cased path, added-then-ignored field, re-ordered signals", () => {
    const asFirstWritten: EvidenceShapeInput = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        correlatedFailure({ occurredAt: FIRST_EXCEPTION_AT }),
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 3,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      symptomClass: "broken",
    };

    const afterTheChurn: InputWithIgnoredFields = {
      symptomClass: "broken",
      signals: [
        struggleSignal({
          subkind: "backtrack",
          surface: "/checkout",
          attempts: 7,
          strugglingSessions: 3,
          kept: 10,
        }),
        correlatedFailure({ occurredAt: FIRST_EXCEPTION_AT }),
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 3,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      surface: normalisedSurface("/Checkout/"),
      detector: "funnel_dropoff",

      addedByALaterWaveAndNotReadByV1: "must not change the identity",
    };

    expect(normalisedSurface("/Checkout/")).toBe(normalisedSurface("/checkout"));

    const first = evidenceShape(asFirstWritten, 1);
    const churned = evidenceShape(afterTheChurn, 1);

    expect(first).toBe(GOLDEN_V1);
    expect(churned).toBe(first);

    expect(first.startsWith("{")).toBe(true);
    expect(first).toContain('"detector":"funnel_dropoff"');
    expect(first).not.toMatch(/^[0-9a-f]{32,}$/);
  });
});

describe("evidenceShape — magnitudes and instants are excluded", () => {
  test("should exclude every magnitude and every instant from the serialisation", () => {
    const leanWeek: EvidenceShapeInput = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        correlatedFailure({ occurredAt: FIRST_EXCEPTION_AT }),
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 3,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      symptomClass: "broken",
    };

    const heavyWeek: InputWithIgnoredFields = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        correlatedFailure({ occurredAt: LATER_EXCEPTION_AT }),
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 41,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      symptomClass: "broken",

      counts: [{ numerator: 41, denominator: 96, unit: "sessions" }],
      timeframe: { start: FIRST_EXCEPTION_AT, end: LATER_EXCEPTION_AT },
    };

    const lean = evidenceShape(leanWeek, 1);
    const heavy = evidenceShape(heavyWeek, 1);

    expect(lean).toBe(GOLDEN_V1);
    expect(heavy).toBe(lean);

    expect(heavy).not.toContain("41");
    expect(heavy).not.toContain("96");
    expect(heavy).not.toContain("45000");
    expect(heavy).not.toContain("2026");
    expect(heavy).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(heavy).not.toMatch(/T\d{2}:\d{2}/);

    expect(heavy).not.toMatch(/\d\.\d/);
  });
});

describe("evidenceShape — versioning forks deliberately", () => {
  test("should fork deliberately on a version bump while EVIDENCE_SHAPE_SERIALISERS.get(1) still reproduces the v1 string", () => {
    const candidate: EvidenceShapeInput = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        correlatedFailure({ occurredAt: FIRST_EXCEPTION_AT }),
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 3,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      symptomClass: "broken",
    };

    expect(EVIDENCE_SHAPE_VERSION).toBe(1);
    expect(evidenceShape(candidate, 1)).toContain('"v":1');

    const v1 = EVIDENCE_SHAPE_SERIALISERS.get(EVIDENCE_SHAPE_VERSION);
    expect(v1).toBeDefined();
    expect(v1?.(candidate)).toBe(GOLDEN_V1);
    expect(v1?.(candidate)).toBe(evidenceShape(candidate, 1));

    expect(() => evidenceShape(candidate, 2)).toThrow(/version/i);
  });
});

describe("evidenceShape — un-normalised paths are refused (security, PII)", () => {
  test("should reject an un-normalised path reaching the serialiser", () => {
    const pathMessage = /path/i;

    expect(() => evidenceShape(withSurface("/checkout?utm_source=newsletter"), 1)).toThrow(
      pathMessage,
    );
    expect(() => evidenceShape(withSurface("/Checkout"), 1)).toThrow(pathMessage);
    expect(() => evidenceShape(withSurface("/checkout/"), 1)).toThrow(pathMessage);
    expect(() =>
      evidenceShape(withSurface("/reset-password/9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"), 1),
    ).toThrow(pathMessage);

    const refusalFor = (rawSurface: string): string => {
      try {
        evidenceShape(withSurface(rawSurface), 1);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error(`fixture must be refused by evidenceShape: ${rawSurface}`);
    };

    const liveToken = "9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c";
    const tokenRefusal = refusalFor(`/reset-password/${liveToken}`);

    expect(tokenRefusal).toMatch(pathMessage);

    expect(tokenRefusal).not.toContain(liveToken);
    expect(tokenRefusal).not.toContain(`/reset-password/${liveToken}`);

    expect(tokenRefusal).toContain("/reset-password/:id");

    const emailAddress = "ada.lovelace@example.com";
    const emailRefusal = refusalFor(`/u/${emailAddress}/settings`);
    expect(emailRefusal).toMatch(pathMessage);
    expect(emailRefusal).not.toContain(emailAddress);
    expect(emailRefusal).not.toContain("ada.lovelace");
    expect(emailRefusal).toContain("/u/:id/settings");

    expect(() => evidenceShape(withSurface(normalisedSurface("/Checkout/")), 1)).not.toThrow(
      pathMessage,
    );
  });
});

describe("evidenceShape — surfaceNormalisationVersion is part of identity", () => {
  test("should carry surfaceNormalisationVersion so a normalisation change is detectable rather than a silent fork", () => {
    const atVersion = (surfaceNormalisationVersion: number | null): EvidenceShapeInput => ({
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion,
      signals: [
        correlatedFailure({ occurredAt: FIRST_EXCEPTION_AT }),
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 3,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      symptomClass: "broken",
    });

    const underV1Rules = evidenceShape(atVersion(1), 1);
    const underCurrentRules = evidenceShape(atVersion(URL_PATH_NORMALISATION_VERSION), 1);

    const unversionedLegacyRow = evidenceShape(atVersion(null), 1);

    expect(underCurrentRules).toBe(GOLDEN_V1);
    expect(underV1Rules).not.toBe(underCurrentRules);
    expect(unversionedLegacyRow).not.toBe(underV1Rules);
    expect(unversionedLegacyRow).not.toBe(underCurrentRules);

    expect(underCurrentRules).toContain(
      `"surfaceNormalisationVersion":${URL_PATH_NORMALISATION_VERSION}`,
    );
    expect(underV1Rules).toContain('"surfaceNormalisationVersion":1');
    expect(unversionedLegacyRow).toContain('"surfaceNormalisationVersion":null');
  });
});
