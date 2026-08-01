// The canonical, versioned tuple string over `(project_id, surface_id, symptom_class,
// evidence_shape)`. The identity half of the signature ledger.
//
// This module produces a string, never a digest. `packages/db/src/signatures/hex.ts`
// hashes this output with `node:crypto`. That is the only place a sha256 is computed
// for this identity, and it is deliberately outside this package so `packages/core/src`
// never imports a node builtin (`purity.test.ts`).
//
// Input / churn table (load-bearing, not documentation garnish) ─
//
// | Input | Derived? | Known churn events | Mechanism |
// |----------------|----------------------------------------------|--------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
// | `projectId` | No — a `randomUUID` PK, immutable | none | n/a |
// | `surfaceId` | Yes — at MVP the normalised URL path | `URL_PATH_NORMALISATION_VERSION` bump; a customer route rename; the M1 ts-morph swap; a per-origin aggregation change | `signature_ancestry` + carry-forward (ADD D-3) |
// | `symptomClass` | Yes — the gate's `finalClass` | a threshold change that flips the class | deliberate fork — it is now a different claim (ADD D-6) |
// | `evidenceShape`| Yes — a versioned canonical string | `EVIDENCE_SHAPE_VERSION` bump | the versioned serialiser map + `signature_ancestry` |
//
// The redundancy is deliberate
//
// `surfaceId` and `symptomClass` are already embedded inside `evidenceShape` v1
// (`evidence-shape.ts:138`, `:141`, `surface` and `symptomClass`). Include them anyway,
// exactly as `architecture.md:129` specifies, with the redundancy stated here in these
// words so a future reader does not "simplify" it away and fork every signature on
// record: two equal inputs still produce two equal digests, so the redundancy costs
// nothing, and it is the safe direction if a future `evidence_shape` version ever
// removes a field. The tuple would still carry the surface and the class independently
// of whatever `evidence_shape` v happens to serialise.
//
// /: `thresholdRuleSetVersion` is not an identity input
//
// It appears nowhere in `SignatureTupleInput`. The input type is the allowlist,
// `signatureTuple` cannot read a field its input type does not declare, so this is
// structural, not a convention. Including it would fork every signature on every
// threshold tweak, un-suppressing every dismissal on record. The exact catastrophe
// exists to prevent, triggered by a one-line constant change. The "some fork, some
// don't" asymmetry is correct: identity is what the problem IS (the gate's output class
// and the signal kinds, both inside `evidence_shape`), not which rules found it. A
// threshold change that flips `finalClass` should fork, because it is now a different
// claim. That decision is closed. NO, pinned by two tests in `signature-churn.test.ts`
// .
//
// Fail direction: refuse. An unknown tuple version throws rather than falling back to
// the current serialiser. A silent fallback would mint a v1-shaped string for a v2
// caller and silently detach every guarantee hanging off the signature (same reasoning
// as `evidence-shape.ts:160-172`).
import type { FindingClass } from "../rules/types";
// `canonicalJson` is the one canonical-string producer this module must call from
// `serialiseV1`, never re-implemented.
import { canonicalJson } from "../serialise/canonical-json";
import type { CanonicalObject } from "../serialise/canonical-json";

/** The version new tuples are serialised under. */
export const SIGNATURE_TUPLE_VERSION = 1;

/**
 * Everything `signatureTuple` may read. Narrow by design, this type is the allowlist,
 * and `thresholdRuleSetVersion` is deliberately absent: a field not declared here
 * cannot enter the identity, no matter what a future `CandidateFinding` grows.
 *
 * `evidenceShape` is already the pre-serialised canonical string
 * (`CandidateFinding.evidenceShape`, `candidate.ts:78`). This module hashes it as-is
 * and does not re-derive it from an `EvidenceShapeInput`. `surfaceId` is
 * `CandidateFinding.surface`, already refused by `assertNormalisedSurface` inside
 * `evidenceShape` (`evidence-shape.ts:104-114`) if it is not a `normaliseUrlPath` fixed
 * point; this module does not re-normalise and does not add a second check.
 */
export type SignatureTupleInput = {
  /** A `randomUUID` PK. `CandidateFinding` carries no `project_id` field. The caller
   * supplies this explicitly from its own `TenantContext`/param. */
  readonly projectId: string;
  /** The normalised `url_path` at MVP (`CandidateFinding.surface`). */
  readonly surfaceId: string;
  /** The gate's final class (`CandidateFinding.finalClass`). */
  readonly symptomClass: FindingClass;
  /** The already-serialised evidence-shape string (`CandidateFinding.evidenceShape`),
   * never an `EvidenceShapeInput`. */
  readonly evidenceShape: string;
};

/** One version's serialiser. */
export type SignatureTupleSerialiser = (input: SignatureTupleInput) => string;

/**
 * Every serialiser ever shipped, keyed by version, the same versioned-map pattern as
 * `EVIDENCE_SHAPE_SERIALISERS`, `THRESHOLD_RULE_SETS`, and `PROOF_PREDICATES`.
 *
 * A version bump forks the tuple string deliberately, and `get` must still reproduce
 * the v1 string exactly.
 */
export const SIGNATURE_TUPLE_SERIALISERS: ReadonlyMap<number, SignatureTupleSerialiser> = new Map([
  [1, serialiseV1],
]);

/**
 * v1. Frozen: this function must reproduce the same bytes forever, so it reads a
 * literal `1` rather than `SIGNATURE_TUPLE_VERSION`. A later bump moves that constant
 * and must not reach back and rewrite every v1 identity on record
 * (`evidence-shape.ts:116-119` precedent).
 *
 * Body is exactly `canonicalJson({ v: 1, projectId, surfaceId, symptomClass,
 * evidenceShape })`. Allowlist by construction; a field added to `SignatureTupleInput`
 * later cannot change the output without also being read here.
 *
 * Key order and set semantics are `canonicalJson`'s, not this function's. Called, never
 * re-implemented, so no second definition of "canonical" exists anywhere in this
 * codebase.
 */
function serialiseV1(input: SignatureTupleInput): string {
  const tuple: CanonicalObject = {
    v: 1,
    projectId: input.projectId,
    surfaceId: input.surfaceId,
    symptomClass: input.symptomClass,
    evidenceShape: input.evidenceShape,
  };

  return canonicalJson(tuple);
}

/**
 * Produces one candidate's canonical signature tuple string.
 *
 * Dispatch is by version, through the map, rather than by "whatever is current". That
 * is what makes `SIGNATURE_TUPLE_SERIALISERS.get` a standing guarantee instead of a
 * coincidence of today's code.
 *
 * Fail direction: refuse. An unknown `version` throws rather than falling back to the
 * current serialiser. A silent fallback would mint a
 * `v${SIGNATURE_TUPLE_VERSION}`-shaped string for a different version's row and
 * silently detach every guarantee hanging off its signature.
 */
export function signatureTuple(input: SignatureTupleInput, version: number): string {
  const serialiser = SIGNATURE_TUPLE_SERIALISERS.get(version);
  if (serialiser === undefined) {
    throw new Error(
      `signatureTuple has no serialiser registered for version ${String(version)}: a tuple can ` +
        `only be produced by the exact version that wrote it. Falling back to the current ` +
        `version would mint a v${String(SIGNATURE_TUPLE_VERSION)} string for a v${String(version)} ` +
        `identity and silently detach every guarantee hanging off its signature.`,
    );
  }

  return serialiser(input);
}
