// `evidence_shape` — the versioned canonical serialisation that answers
// "IS THIS THE SAME PROBLEM?" and nothing else (O-004 D-12, FR-16, D12).
//
// It is a canonical STRING, not a hash. Architecture D-2 defines
// `signature = sha256(project_id, surface_id, symptom_class, evidence_shape)`,
// so this is an INPUT O-006 hashes — which is why no node builtin enters this
// package at all (D-13).
//
// ── WHAT IS DELIBERATELY EXCLUDED, AND THIS IS THE LOAD-BEARING HALF ────────
//
// Every MAGNITUDE (numerators, denominators, rates) and every INSTANT
// (timeframes, `occurredAt`). Including a count would fork the signature every
// time the rate moved by one session — the same problem next week would be a
// different problem, and the ledger's "never surface twice" guarantee would
// fail open on ordinary traffic variation. Including a timeframe would fork it
// every analysis window, which is worse. The magnitudes travel on the
// candidate BESIDE the shape, where O-006 and O-007 read them without them
// being identity.
//
// ── ALLOWLIST BY CONSTRUCTION ───────────────────────────────────────────────
//
// The serialiser reads named fields off its input and nothing else, following
// `packages/adapters/src/posthog/parse.ts:83-92`'s stated principle: reading
// only the keys we use makes the dead-code guard STRUCTURAL instead of a
// convention. An added-then-ignored field cannot change the output, because
// there is no code path that could read it.
//
// Implemented in Wave 4 against this scaffold's final signatures.
import { normaliseUrlPath } from "@growthmind/shared";

import type { EvidenceSignal } from "../evidence/signals";
import type { DetectorName, FindingClass } from "../rules/types";
import { canonicalJson } from "../serialise/canonical-json";
import type { CanonicalObject } from "../serialise/canonical-json";

/** The version new shapes are serialised under. */
export const EVIDENCE_SHAPE_VERSION = 1;

/**
 * Everything a v1 shape may read. Narrow BY DESIGN — this type is the
 * allowlist, and widening it is the visible, reviewable event that a
 * normalisation or identity change ought to be.
 */
export type EvidenceShapeInput = {
  /** A rule-set enum, never a free string — a free string here is a D12 fork
   * waiting for a typo. */
  readonly detector: DetectorName;
  /** The normalised `url_path`. Already lowercased and redacted by
   * `normaliseUrlPath`; a test asserts no un-normalised path can reach the
   * serialiser (product-decisions §5). */
  readonly surface: string;
  /** Pins WHICH rules produced `surface`, so a normalisation change is a
   * detectable, migratable event rather than a silent fork (D-15, FR-18).
   * `null` for a row written before versions were recorded (ES-14). */
  readonly surfaceNormalisationVersion: number | null;
  /** Only the `kind` values are read — sorted and de-duplicated. The signals'
   * own magnitudes and instants are not part of identity. */
  readonly signals: readonly EvidenceSignal[];
  /** The gate's FINAL class. */
  readonly symptomClass: FindingClass;
};

/** One version's serialiser. */
export type EvidenceShapeSerialiser = (input: EvidenceShapeInput) => string;

/**
 * Every serialiser ever shipped, keyed by version — the same versioned-map
 * pattern as `THRESHOLD_RULE_SETS` and `EXCLUSION_RULE_SETS`.
 *
 * A version bump FORKS the shape DELIBERATELY, and `get(1)` must still
 * reproduce the v1 string exactly. That pair of properties is what makes a
 * serialisation change a migratable event instead of a silent D12 identity
 * fork across every finding on record.
 */
export const EVIDENCE_SHAPE_SERIALISERS: ReadonlyMap<number, EvidenceShapeSerialiser> = new Map([
  [1, serialiseV1],
]);

/**
 * The last gate before a path becomes part of an identity, and the one place
 * this package can still refuse.
 *
 * An un-normalised path is two hazards at once. It is a D12 fork — one campaign
 * link's query string, or one differently-cased href, mints a second identity
 * for the same problem — and it is a PII leak: `normaliseUrlPath` is what
 * redacts an identifier-shaped segment, so a path that has not been through it
 * can still carry a live reset token or an email address (security audit H-2,
 * product-decisions §5), permanently, in the identity of a finding.
 *
 * The check is IDEMPOTENCE, not a pattern list: a value is normalised exactly
 * when re-normalising it is a no-op. That inherits every rule
 * `normaliseUrlPath` has and every rule it ever gains, instead of a second copy
 * of them here that would drift and then disagree about what a surface is.
 *
 * FAIL DIRECTION: refuse — but bounded. An already-normalised path is a no-op
 * through here, so "refuse on doubt" cannot degrade into "refuse on
 * everything"; the near-miss control in the test file pins that.
 *
 * The message names the EXPECTED path, never the offending one: echoing the raw
 * value is how a token that must not enter an identity gets copied into a log
 * line instead. The normalised form is already redacted, and it is what makes
 * the refusal debuggable.
 */
function assertNormalisedSurface(surface: string): string {
  const normalised = normaliseUrlPath(surface, null);
  if (normalised === surface) return surface;

  throw new Error(
    `evidenceShape refuses an un-normalised path as a surface: the normalised form is ` +
      `${normalised === null ? "empty" : normalised}. Only a path that has already been through ` +
      `normaliseUrlPath may enter an evidence shape — an un-normalised one forks the identity on ` +
      `an ordinary link and can carry a live token or an email address into it permanently.`,
  );
}

/**
 * v1. Frozen: this function must reproduce the same bytes forever, so it reads
 * a literal `1` rather than `EVIDENCE_SHAPE_VERSION` — a later bump moves that
 * constant and must NOT reach back and rewrite every v1 identity on record.
 *
 * ALLOWLIST BY CONSTRUCTION: every value below is read from a NAMED field, and
 * the only thing read off a signal is its `kind`. A field added to the input by
 * a later wave cannot change this output, because there is no code path here
 * that could read it — the dead-code guard is structural, not a convention
 * (`packages/adapters/src/posthog/parse.ts:83-92`).
 *
 * Key order and set semantics are `canonicalJson`'s, not this function's
 * (D-13): keys lexicographic by code unit, primitive arrays sorted and
 * de-duplicated, non-integer numbers refused. `signalKinds` therefore needs no
 * sorting or de-duplication here — handing over the raw kinds and letting the
 * one canonical serialiser own the ordering is what keeps a second, drifting
 * definition of "canonical" from existing.
 */
function serialiseV1(input: EvidenceShapeInput): string {
  const shape: CanonicalObject = {
    v: 1,
    detector: input.detector,
    surface: assertNormalisedSurface(input.surface),
    surfaceNormalisationVersion: input.surfaceNormalisationVersion,
    signalKinds: input.signals.map((signal) => signal.kind),
    symptomClass: input.symptomClass,
  };

  return canonicalJson(shape);
}

/**
 * Serialises one candidate's evidence to its canonical shape string.
 *
 * v1 emits exactly, and only: `v`, `detector`, `surface`,
 * `surfaceNormalisationVersion`, `signalKinds`, `symptomClass` — keys in a
 * fixed declared order, the kind array sorted and de-duplicated, strings
 * verbatim, and NO floating-point value anywhere, which removes number
 * formatting from the problem entirely.
 *
 * Dispatch is BY VERSION, through the map, rather than by "whatever is
 * current": that is what makes `EVIDENCE_SHAPE_SERIALISERS.get(1)` a standing
 * guarantee instead of a coincidence of today's code.
 *
 * FAIL DIRECTION: refuse. An unknown `version` throws rather than falling back
 * to the current serialiser — a silent fallback would mint a v1 string for a
 * v2 row and detach every guarantee hanging off the signature.
 */
export function evidenceShape(candidate: EvidenceShapeInput, version: number): string {
  const serialiser = EVIDENCE_SHAPE_SERIALISERS.get(version);
  if (serialiser === undefined) {
    throw new Error(
      `evidenceShape has no serialiser registered for version ${String(version)}: a shape can ` +
        `only be produced by the exact version that wrote it. Falling back to the current ` +
        `version would mint a v${String(EVIDENCE_SHAPE_VERSION)} string for a v${String(version)} ` +
        `row and silently detach every guarantee hanging off its signature.`,
    );
  }

  return serialiser(candidate);
}
