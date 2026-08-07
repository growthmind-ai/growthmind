import { URL_PATH_NORMALISATION_VERSION, normaliseUrlPath } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import { admissibleProofKinds } from "../../src/evidence/predicates";
import type { EvidenceSignal } from "../../src/evidence/signals";
import {
  EVIDENCE_SHAPE_SERIALISERS,
  EVIDENCE_SHAPE_VERSION,
  evidenceShape,
} from "../../src/findings/evidence-shape";
import type { EvidenceShapeInput } from "../../src/findings/evidence-shape";
import { CURRENT_THRESHOLD_RULE_SET } from "../../src/rules/thresholds";

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
      basis: { totalInWindow: 10, kept: 10, keptUnchecked: 0, setAside: [] },
    }),
  };
}

// Derived from the one declaration in src/evidence/signals.ts — never re-listed here (D-7).
type StruggleSubkind = Extract<EvidenceSignal, { readonly kind: "struggle" }>["subkind"];

function struggleSignal(input: {
  readonly subkind: StruggleSubkind;
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
      basis: { totalInWindow: input.kept, kept: input.kept, keptUnchecked: 0, setAside: [] },
    }),
  };
}

type InputWithIgnoredFields = EvidenceShapeInput & { readonly [ignored: string]: unknown };

// Derives `proofKinds` the way `assembleCandidates` does. A fixture that hand-listed them could
// stay green while the real call site forked, which is the whole failure B-015 names.
function shapeInput<T extends Omit<EvidenceShapeInput, "proofKinds">>(
  input: T,
): T & EvidenceShapeInput {
  return {
    ...input,
    proofKinds: admissibleProofKinds(input.signals, input.symptomClass, CURRENT_THRESHOLD_RULE_SET),
  };
}

const GOLDEN_V1 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_correlated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":3,"symptomClass":"broken","v":1}';

const GOLDEN_V2 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_correlated","struggle"],' +
  '"surface":"/checkout","symptomClass":"broken","v":2}';

// `struggle` is absent: it is in the window, and it is not admissible proof of `broken`.
const GOLDEN_V3 =
  '{"detector":"funnel_dropoff","proofKinds":["failure_correlated"],' +
  '"surface":"/checkout","symptomClass":"broken","v":3}';

function withSurface(surface: string): EvidenceShapeInput {
  return shapeInput({
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
  });
}

describe("evidenceShape — identity across a churn event", () => {
  test("should serialise identically across a churn event: re-ordered payload, differently-cased path, added-then-ignored field, re-ordered signals", () => {
    const asFirstWritten: EvidenceShapeInput = shapeInput({
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
    });

    const afterTheChurn: InputWithIgnoredFields = shapeInput({
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
    });

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
    const leanWeek: EvidenceShapeInput = shapeInput({
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
    });

    const heavyWeek: InputWithIgnoredFields = shapeInput({
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
    });

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
    const candidate: EvidenceShapeInput = shapeInput({
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
    });

    expect(EVIDENCE_SHAPE_VERSION).toBe(3);
    expect(evidenceShape(candidate, 1)).toContain('"v":1');
    expect(evidenceShape(candidate, 2)).toContain('"v":2');
    expect(evidenceShape(candidate, 3)).toContain('"v":3');

    const current = EVIDENCE_SHAPE_SERIALISERS.get(EVIDENCE_SHAPE_VERSION);
    expect(current).toBeDefined();
    expect(current?.(candidate)).toBe(GOLDEN_V3);
    expect(current?.(candidate)).toBe(evidenceShape(candidate, EVIDENCE_SHAPE_VERSION));

    // Every retired serialiser stays reachable by its own number, and only by its own number.
    expect(EVIDENCE_SHAPE_SERIALISERS.get(1)?.(candidate)).toBe(GOLDEN_V1);
    expect(EVIDENCE_SHAPE_SERIALISERS.get(2)?.(candidate)).toBe(GOLDEN_V2);
    expect(evidenceShape(candidate, 1)).not.toBe(evidenceShape(candidate, 2));
    expect(evidenceShape(candidate, 2)).not.toBe(evidenceShape(candidate, 3));

    expect(() => evidenceShape(candidate, 4)).toThrow(/version/i);
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

describe("evidenceShape — surfaceNormalisationVersion is provenance, not identity (B-016)", () => {
  const atVersion = (surfaceNormalisationVersion: number | null): EvidenceShapeInput =>
    shapeInput({
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

  test("should hold one identity across the whole 2 → null → 3 rollout walk", () => {
    // The walk a real surface takes across a URL_PATH_NORMALISATION_VERSION bump: unanimous on
    // the old version, then null while the window straddles the boundary and the events on the
    // surface disagree, then unanimous on the new one. Under v1 that was three identities.
    const before = evidenceShape(atVersion(URL_PATH_NORMALISATION_VERSION), 2);
    const midRollout = evidenceShape(atVersion(null), 2);
    const after = evidenceShape(atVersion(URL_PATH_NORMALISATION_VERSION + 1), 2);

    expect(before).toBe(GOLDEN_V2);
    expect(midRollout).toBe(before);
    expect(after).toBe(before);

    expect(before).not.toContain("surfaceNormalisationVersion");
  });

  test("should not collide the mid-rollout null with the legacy pre-versioning null", () => {
    // The second half of the fork: `null` meant both "the window straddles a bump" and "written
    // before versions were recorded". Neither is in the identity now, so neither can collide.
    expect(evidenceShape(atVersion(null), 2)).toBe(
      evidenceShape(atVersion(URL_PATH_NORMALISATION_VERSION), 2),
    );
  });

  test("should still reproduce the v1 string for a row written under v1", () => {
    // A stored v1 shape must keep recomputing to itself, or every guarantee hanging off it
    // detaches silently — the failure `evidenceShape` refuses by construction.
    expect(evidenceShape(atVersion(URL_PATH_NORMALISATION_VERSION), 1)).toBe(GOLDEN_V1);
    expect(evidenceShape(atVersion(1), 1)).toContain('"surfaceNormalisationVersion":1');
    expect(evidenceShape(atVersion(null), 1)).toContain('"surfaceNormalisationVersion":null');
  });
});

const SIGNALS_SOURCE = `${import.meta.dir}/../../src/evidence/signals.ts`.replaceAll("\\", "/");

// TODO(O-041 T3.1): replace the deferred load with a static import of struggleSubkindSchema.
type SignalsModule = {
  readonly struggleSubkindSchema: { readonly options: readonly StruggleSubkind[] };
};

async function declaredStruggleSubkinds(): Promise<readonly StruggleSubkind[]> {
  const loaded = (await import(SIGNALS_SOURCE)) as Partial<SignalsModule>;
  const schema = loaded.struggleSubkindSchema;

  if (schema === undefined || !Array.isArray(schema.options)) {
    throw new Error(
      "src/evidence/signals.ts must export struggleSubkindSchema — the one declaration of the " +
        "struggle subkind union every other reference derives from (D-7).",
    );
  }

  return schema.options;
}

// The six the contract names, not the union: `backtrack` is deliberately absent, so this is a
// fixture list rather than a fifth copy of the members.
const SUBKINDS_NAMED_BY_THE_CONTRACT: readonly string[] = [
  "repeated_attempt",
  "rage_click",
  "dead_click",
  "field_abandoned",
  "field_refocus",
  "scroll_back",
];

const GOLDEN_STRUGGLE_ONLY_V3 =
  '{"detector":"funnel_dropoff","proofKinds":["struggle"],' +
  '"surface":"/checkout","symptomClass":"confusing","v":3}';

describe("evidenceShape — the struggle subkind is invisible to the identity (D-4, D-7)", () => {
  test("should produce the same evidence shape for a struggle signal regardless of its subkind", async () => {
    const declared = await declaredStruggleSubkinds();
    const declaredNames: readonly string[] = declared;

    for (const named of SUBKINDS_NAMED_BY_THE_CONTRACT) {
      expect(declaredNames).toContain(named);
    }

    const shapes = declared.map((subkind) =>
      evidenceShape(
        shapeInput({
          detector: "funnel_dropoff",
          surface: normalisedSurface("/checkout"),
          surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
          signals: [
            struggleSignal({
              subkind,
              surface: "/checkout",
              attempts: 3,
              strugglingSessions: 3,
              kept: 10,
            }),
          ],
          symptomClass: "confusing",
        }),
        EVIDENCE_SHAPE_VERSION,
      ),
    );

    for (const [index, shape] of shapes.entries()) {
      expect(shape).toBe(GOLDEN_STRUGGLE_ONLY_V3);
      expect(shape).toBe(shapes[0]);
      expect(shape).not.toContain(declared[index]);
    }
  });
});

describe("evidenceShape — only admissible proof is identity (B-015)", () => {
  const brokenWith = (signals: readonly EvidenceSignal[]): EvidenceShapeInput =>
    shapeInput({
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals,
      symptomClass: "broken",
    });

  const UNCORRELATED_STRAGGLER: EvidenceSignal = {
    kind: "failure_uncorrelated",
    eventName: "$exception",
    occurredAt: LATER_EXCEPTION_AT,
  };

  test("should hold one identity when a straggler exception lands outside the correlation window", () => {
    // The reported repro: week 1 the bug correlates; week 2 the same bug plus one exception at
    // 31s instead of 29s. Under v2 that second week minted a new identity, so the finding was
    // re-delivered as new and a standing dismissal stopped matching it.
    const weekOne = brokenWith([correlatedFailure()]);
    const weekTwo = brokenWith([correlatedFailure(), UNCORRELATED_STRAGGLER]);

    expect(evidenceShape(weekTwo, 3)).toBe(evidenceShape(weekOne, 3));
    expect(evidenceShape(weekTwo, 3)).not.toContain("failure_uncorrelated");

    // v2 is what forked, and it must keep forking — a row written under it recomputes to the
    // string it was written as, or every guarantee hanging off that row detaches silently.
    expect(evidenceShape(weekTwo, 2)).not.toBe(evidenceShape(weekOne, 2));
  });

  test("should keep a kind that IS admissible proof for the class in the identity", () => {
    // The narrower reading — "drop everything but one kind" — would make two genuinely
    // different problems collide. `struggle` proves `confusing`, so it stays there.
    const confusing = shapeInput({
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        struggleSignal({
          subkind: "repeated_attempt",
          surface: "/checkout",
          attempts: 3,
          strugglingSessions: 3,
          kept: 10,
        }),
      ],
      symptomClass: "confusing",
    });

    expect(evidenceShape(confusing, 3)).toContain('"proofKinds":["struggle"]');
    expect(evidenceShape(confusing, 3)).not.toBe(
      evidenceShape(brokenWith([correlatedFailure()]), 3),
    );
  });

  test("should not fork on the order the detector happened to emit its signals in", () => {
    const emittedOneWay = brokenWith([correlatedFailure(), UNCORRELATED_STRAGGLER]);
    const emittedTheOther = brokenWith([UNCORRELATED_STRAGGLER, correlatedFailure()]);

    expect(evidenceShape(emittedTheOther, 3)).toBe(evidenceShape(emittedOneWay, 3));
  });
});

describe("evidenceShape — the version is pinned across this sprint (D-4)", () => {
  test("should keep EVIDENCE_SHAPE_VERSION at 3", () => {
    expect(EVIDENCE_SHAPE_VERSION).toBe(3);
    expect(EVIDENCE_SHAPE_SERIALISERS.size).toBe(3);
  });
});
