// ADD §7 "Unit — `evidence_shape`" — the five named tests for `evidenceShape`
// (D-12, FR-16, FR-18, D12).
//
// The contract these tests pin:
//   1. `evidence_shape` is a canonical STRING, never a hash. Architecture D-2
//      defines `signature = sha256(project_id, surface_id, symptom_class,
//      evidence_shape)` — O-006 does the hashing, which is why no node builtin
//      enters `packages/core` at all (D-13).
//   2. v1 serialises EXACTLY and ONLY `v`, `detector`, `surface`,
//      `surfaceNormalisationVersion`, `signalKinds` (sorted + de-duplicated),
//      `symptomClass`. Every MAGNITUDE and every INSTANT is excluded — that
//      exclusion is the load-bearing half, not a simplification.
//   3. A version bump FORKS the shape deliberately, and version 1 stays
//      reproducible forever.
//
// WHY "SAME INPUT TWICE" IS EXPLICITLY INSUFFICIENT HERE (D12). A deterministic
// id is exactly as stable as its LEAST stable input. If the shape forks on an
// ordinary refactor, every guarantee hanging off the signature ledger —
// never-deliver-twice, dismissed-forever, never-re-propose — fails open with NO
// ERROR: the system simply starts repeating itself. So the first test below
// computes the shape, applies a realistic CHURN MUTATION to the fixture, and
// asserts byte-identity across it.
//
// No clock and no randomness in this file — every instant is a fixture
// constant, never `Date.now()` (ADD §6.5, FR-5).
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

// --- fixture time (required parameter, never `Date.now()` — ADD §6.5) --------

/** The instant the "lean week" fixture's exception was thrown. */
const FIRST_EXCEPTION_AT = new Date("2026-06-01T10:00:00.000Z");
/** A DIFFERENT analysis window's instant, six weeks later. Test 2 exists to
 * prove this difference cannot reach the serialisation. */
const LATER_EXCEPTION_AT = new Date("2026-07-13T22:45:31.000Z");

// --- fixture helpers ---------------------------------------------------------

/**
 * The surface as the pipeline actually produces it: through `normaliseUrlPath`,
 * never hand-written. Writing `"/checkout"` as a literal in a fixture would
 * quietly pre-normalise the input and make the churn test prove nothing.
 */
function normalisedSurface(rawPathname: string): string {
  const surface = normaliseUrlPath(rawPathname, null);
  if (surface === null) {
    throw new Error(`fixture pathname must normalise to a surface: ${rawPathname}`);
  }
  return surface;
}

/**
 * A struggle signal, built where every other fixture in this file writes an
 * object literal.
 *
 * It exists because `struggle` carries a `MeasuredCount` (`strugglingSessions`,
 * H-1) which only `measuredCount` can construct — and that is itself worth
 * something here: the cohort is a MAGNITUDE, so a signal that now carries a
 * whole count with a denominator, a basis and a timeframe inside it must STILL
 * serialise to the same `GOLDEN_V1`. v1 reads a signal's `kind` and nothing
 * else, and this is the fixture that proves adding a field to a signal cannot
 * move an identity already on record.
 */
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

/**
 * An input plus arbitrary extra keys — the "added-then-ignored field" of the
 * churn event, and the vehicle for test 2's counts and timeframe.
 *
 * This type is how the ALLOWLIST-BY-CONSTRUCTION claim (D-12, mirroring
 * `packages/adapters/src/posthog/parse.ts:83-92`) becomes testable: the
 * serialiser reads named fields off its input and nothing else, so an added
 * field cannot change the output because there is no code path that could read
 * it. The intersection keeps this a real `EvidenceShapeInput` — no `as` cast.
 */
type InputWithIgnoredFields = EvidenceShapeInput & { readonly [ignored: string]: unknown };

/**
 * The one v1 string this whole file is anchored to.
 *
 * Keys are ordered lexicographically by code unit and set-shaped arrays are
 * sorted + de-duplicated, because D-13 states `evidence_shape` uses
 * `canonicalJson`, whose ordering PL ruling 5 fixes — the identical golden
 * appears in `__tests__/serialise/canonical-json.test.ts`. It is cleartext, not
 * a digest: `evidence_shape` is an INPUT O-006 hashes, not the hash.
 */
const GOLDEN_V1 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_correlated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":2,"symptomClass":"broken","v":1}';

/**
 * A candidate whose ONLY varying input is the surface — so the refusal test
 * below isolates the path and nothing else.
 */
function withSurface(surface: string): EvidenceShapeInput {
  return {
    detector: "funnel_dropoff",
    surface,
    surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
    signals: [{ kind: "struggle", subkind: "repeated_attempt", surface, attempts: 3 }],
    symptomClass: "confusing",
  };
}

describe("evidenceShape — identity across a churn event (FR-16, D12)", () => {
  test("should serialise identically across a churn event: re-ordered payload, differently-cased path, added-then-ignored field, re-ordered signals", () => {
    // The evidence as first written. Keys in the order D-12's table declares
    // them, the path arriving lowercase, two signals in detector order.
    const asFirstWritten: EvidenceShapeInput = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        {
          kind: "failure_correlated",
          eventName: "$exception",
          occurredAt: FIRST_EXCEPTION_AT,
          precedingActionName: "checkout_submit",
          correlationWindowMs: 30_000,
        },
        { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts: 3 },
      ],
      symptomClass: "broken",
    };

    // THE SAME LOGICAL EVIDENCE after an ordinary week of churn — all four
    // mutations at once, none of which changes what problem this is:
    //   (a) the source payload was rebuilt in a different key order;
    //   (b) the source path arrived differently cased, with a trailing slash;
    //   (c) a later wave added a field this version does not read;
    //   (d) the signals were appended in a different order, with a duplicate
    //       kind from a second session.
    const afterTheChurn: InputWithIgnoredFields = {
      symptomClass: "broken",
      signals: [
        { kind: "struggle", subkind: "backtrack", surface: "/checkout", attempts: 7 },
        {
          kind: "failure_correlated",
          eventName: "$exception",
          occurredAt: FIRST_EXCEPTION_AT,
          precedingActionName: "checkout_submit",
          correlationWindowMs: 30_000,
        },
        { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts: 3 },
      ],
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      surface: normalisedSurface("/Checkout/"),
      detector: "funnel_dropoff",
      // (c) — present on the object, unreadable by any v1 code path.
      addedByALaterWaveAndNotReadByV1: "must not change the identity",
    };

    // The churn is REAL, not a fixture that quietly pre-normalised both sides:
    // two differently-cased source paths, one surface.
    expect(normalisedSurface("/Checkout/")).toBe(normalisedSurface("/checkout"));

    const first = evidenceShape(asFirstWritten, 1);
    const churned = evidenceShape(afterTheChurn, 1);

    expect(first).toBe(GOLDEN_V1);
    expect(churned).toBe(first);

    // A CANONICAL STRING, NOT A HASH (D-12, architecture D-2). The fields are
    // readable in the output; a digest would be opaque, and producing one here
    // would require `node:crypto` inside `packages/core`, which D-13 forbids.
    expect(first.startsWith("{")).toBe(true);
    expect(first).toContain('"detector":"funnel_dropoff"');
    expect(first).not.toMatch(/^[0-9a-f]{32,}$/);
  });
});

describe("evidenceShape — magnitudes and instants are excluded (D-12)", () => {
  test("should exclude every magnitude and every instant from the serialisation", () => {
    // This is the load-bearing exclusion. Including a count would fork the
    // signature every time the rate moved by one session — the same problem
    // next week would be a different problem, and the ledger's "never surface
    // twice" would fail open on ordinary traffic variation. Including a
    // timeframe would fork it every analysis window, which is worse. The shape
    // answers "is this the same problem?", never "how bad is it this week?".
    const leanWeek: EvidenceShapeInput = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        {
          kind: "failure_correlated",
          eventName: "$exception",
          occurredAt: FIRST_EXCEPTION_AT,
          precedingActionName: "checkout_submit",
          correlationWindowMs: 30_000,
        },
        { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts: 3 },
      ],
      symptomClass: "broken",
    };

    // The same problem, six weeks later and far worse: every magnitude moved,
    // every instant moved, and the candidate now travels beside a count and a
    // timeframe. NONE of it may reach the identity.
    const heavyWeek: InputWithIgnoredFields = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        {
          kind: "failure_correlated",
          eventName: "$exception",
          occurredAt: LATER_EXCEPTION_AT,
          precedingActionName: "checkout_submit",
          correlationWindowMs: 45_000,
        },
        { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts: 41 },
      ],
      symptomClass: "broken",
      // The magnitudes and the window travel BESIDE the shape on the candidate,
      // where O-006 and O-007 read them without them being identity — so even
      // handed to the serialiser directly, they must be unreadable.
      counts: [{ numerator: 41, denominator: 96, unit: "sessions" }],
      timeframe: { start: FIRST_EXCEPTION_AT, end: LATER_EXCEPTION_AT },
    };

    const lean = evidenceShape(leanWeek, 1);
    const heavy = evidenceShape(heavyWeek, 1);

    expect(lean).toBe(GOLDEN_V1);
    expect(heavy).toBe(lean);

    // Named exclusions, so a regression says WHICH thing leaked rather than
    // only that two strings diverged.
    expect(heavy).not.toContain("41"); // a numerator
    expect(heavy).not.toContain("96"); // a denominator
    expect(heavy).not.toContain("45000"); // a correlation window
    expect(heavy).not.toContain("2026"); // any instant's year
    expect(heavy).not.toMatch(/\d{4}-\d{2}-\d{2}/); // any ISO date
    expect(heavy).not.toMatch(/T\d{2}:\d{2}/); // any ISO time

    // NO FLOATING-POINT VALUE ANYWHERE, which removes number formatting from
    // the problem entirely (D-12). A serialiser that guesses at float
    // formatting produces an identity that forks on the guess.
    expect(heavy).not.toMatch(/\d\.\d/);
  });
});

describe("evidenceShape — versioning forks deliberately (FR-16)", () => {
  test("should fork deliberately on a version bump while EVIDENCE_SHAPE_SERIALISERS.get(1) still reproduces the v1 string", () => {
    const candidate: EvidenceShapeInput = {
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
      signals: [
        {
          kind: "failure_correlated",
          eventName: "$exception",
          occurredAt: FIRST_EXCEPTION_AT,
          precedingActionName: "checkout_submit",
          correlationWindowMs: 30_000,
        },
        { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts: 3 },
      ],
      symptomClass: "broken",
    };

    // THE FORK IS STRUCTURAL, not a convention: the version is itself a
    // serialised field, so bumping it necessarily changes the string. That is
    // what makes a serialisation change a MIGRATABLE EVENT rather than a silent
    // D12 identity fork across every finding on record.
    expect(EVIDENCE_SHAPE_VERSION).toBe(1);
    expect(evidenceShape(candidate, 1)).toContain('"v":1');

    // Version 1 stays reproducible FOREVER, fetched by version rather than by
    // "whatever is current" — the same versioned-map discipline as
    // `THRESHOLD_RULE_SETS`.
    const v1 = EVIDENCE_SHAPE_SERIALISERS.get(EVIDENCE_SHAPE_VERSION);
    expect(v1).toBeDefined();
    expect(v1?.(candidate)).toBe(GOLDEN_V1);
    expect(v1?.(candidate)).toBe(evidenceShape(candidate, 1));

    // FAIL DIRECTION: refuse. An unregistered version THROWS rather than
    // falling back to the current serialiser — a silent fallback would mint a
    // v1 string for a v2 row and detach every guarantee hanging off the
    // signature. The message must name the version so the refusal is
    // debuggable and distinguishable from any other throw on this path.
    expect(() => evidenceShape(candidate, 2)).toThrow(/version/i);
  });
});

describe("evidenceShape — un-normalised paths are refused (security, PII)", () => {
  test("should reject an un-normalised path reaching the serialiser", () => {
    // Each of these is a path that has NOT been through `normaliseUrlPath`, and
    // each is a distinct hazard the serialiser is the last gate for:
    //   - a query string forks the surface on one campaign link (D12);
    //   - mixed case and a trailing slash fork it on an ordinary link;
    //   - a raw token segment puts a live account-takeover primitive into the
    //     identity of a finding, permanently (security audit H-2,
    //     product-decisions §5 — no PII in streams).
    //
    // The message must name the NORMALISED path, NEVER the raw one (PL ruling
    // 29). Both halves are load-bearing and they pull against each other:
    //   - naming the normalised form is what makes the refusal debuggable —
    //     it is already redacted, so it is safe to print;
    //   - naming the RAW one is how the very value this gate exists to keep
    //     out of a persisted identity gets copied into a log line, an error
    //     tracker and a support ticket instead (§5, security audit H-2 — a
    //     raw path may carry a live reset token or an email address).
    // `/path/i` below matches only the literal WORD "path", so it pins the
    // debuggable half and nothing else; the two assertions after the fixtures
    // pin the safe half.
    const pathMessage = /path/i;

    expect(() => evidenceShape(withSurface("/checkout?utm_source=newsletter"), 1)).toThrow(
      pathMessage,
    );
    expect(() => evidenceShape(withSurface("/Checkout"), 1)).toThrow(pathMessage);
    expect(() => evidenceShape(withSurface("/checkout/"), 1)).toThrow(pathMessage);
    expect(() =>
      evidenceShape(withSurface("/reset-password/9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"), 1),
    ).toThrow(pathMessage);

    // ── RULING 29, ASSERTED RATHER THAN ASSUMED ────────────────────────────
    //
    // Matching /path/i proves the refusal is DEBUGGABLE. It does not prove the
    // refusal is SAFE — a message echoing the offending value back would
    // satisfy it just as well, and that is precisely how a live reset token
    // gets copied into a log line, an error tracker, and a support ticket.
    //
    // The implementation names only the NORMALISED path (ruling 29). Nothing
    // asserted it, so adding `${surface}` to that message would have passed
    // every assertion above. This closes that, in both directions: the raw
    // value must appear NOWHERE in what the refusal says, and the normalised
    // form must appear, so the fix for the leak cannot be "say nothing".
    const refusalFor = (rawSurface: string): string => {
      try {
        evidenceShape(withSurface(rawSurface), 1);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error(`fixture must be refused by evidenceShape: ${rawSurface}`);
    };

    // (a) A live reset token — the H-2 hazard verbatim.
    const liveToken = "9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c";
    const tokenRefusal = refusalFor(`/reset-password/${liveToken}`);
    // NON-VACUITY: a refusal was actually thrown and captured, and it is the
    // debuggable one — not an empty string quietly satisfying `not.toContain`.
    expect(tokenRefusal).toMatch(pathMessage);
    // THE GUARANTEE: neither the token nor the raw path it sat in is echoed.
    expect(tokenRefusal).not.toContain(liveToken);
    expect(tokenRefusal).not.toContain(`/reset-password/${liveToken}`);
    // AND STILL DEBUGGABLE: the redacted form IS named, so a reader knows
    // which surface was refused without the secret travelling with it.
    expect(tokenRefusal).toContain("/reset-password/:id");

    // (b) An email address — the other §5 hazard, and a different redaction
    // predicate, so the guarantee is pinned on more than one shape.
    const emailAddress = "ada.lovelace@example.com";
    const emailRefusal = refusalFor(`/u/${emailAddress}/settings`);
    expect(emailRefusal).toMatch(pathMessage);
    expect(emailRefusal).not.toContain(emailAddress);
    expect(emailRefusal).not.toContain("ada.lovelace");
    expect(emailRefusal).toContain("/u/:id/settings");

    // The near-miss control, so "refuses on doubt" is not "refuses on
    // everything": the already-normalised form of the same page is accepted.
    expect(() => evidenceShape(withSurface(normalisedSurface("/Checkout/")), 1)).not.toThrow(
      pathMessage,
    );
  });
});

describe("evidenceShape — surfaceNormalisationVersion is part of identity (D-12, FR-18)", () => {
  test("should carry surfaceNormalisationVersion so a normalisation change is detectable rather than a silent fork", () => {
    const atVersion = (surfaceNormalisationVersion: number | null): EvidenceShapeInput => ({
      detector: "funnel_dropoff",
      surface: normalisedSurface("/checkout"),
      surfaceNormalisationVersion,
      signals: [
        {
          kind: "failure_correlated",
          eventName: "$exception",
          occurredAt: FIRST_EXCEPTION_AT,
          precedingActionName: "checkout_submit",
          correlationWindowMs: 30_000,
        },
        { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts: 3 },
      ],
      symptomClass: "broken",
    });

    const underV1Rules = evidenceShape(atVersion(1), 1);
    const underCurrentRules = evidenceShape(atVersion(URL_PATH_NORMALISATION_VERSION), 1);
    // ES-14: a row written before versions were recorded.
    const unversionedLegacyRow = evidenceShape(atVersion(null), 1);

    // The version is IN the identity, so re-normalising a surface under new
    // rules is a DETECTABLE, migratable event — a diff O-006 can act on —
    // rather than the same string silently coming to mean something else.
    expect(underCurrentRules).toBe(GOLDEN_V1);
    expect(underV1Rules).not.toBe(underCurrentRules);
    expect(unversionedLegacyRow).not.toBe(underV1Rules);
    expect(unversionedLegacyRow).not.toBe(underCurrentRules);

    // The wire to the producing constant is real: the version serialised is the
    // one `packages/shared` stamps (D-15, FR-18), not a copy that can drift.
    expect(underCurrentRules).toContain(
      `"surfaceNormalisationVersion":${URL_PATH_NORMALISATION_VERSION}`,
    );
    expect(underV1Rules).toContain('"surfaceNormalisationVersion":1');
    expect(unversionedLegacyRow).toContain('"surfaceNormalisationVersion":null');
  });
});
