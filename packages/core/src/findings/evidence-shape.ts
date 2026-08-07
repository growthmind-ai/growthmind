import { normaliseUrlPath } from "@growthmind/shared";

import type { EvidenceSignal, EvidenceSignalKind } from "../evidence/signals";
import type { DetectorName, FindingClass } from "../rules/types";
import { canonicalJson } from "../serialise/canonical-json";
import type { CanonicalObject } from "../serialise/canonical-json";

export const EVIDENCE_SHAPE_VERSION = 3;

export type EvidenceShapeInput = {
  readonly detector: DetectorName;

  readonly surface: string;

  readonly surfaceNormalisationVersion: number | null;

  readonly signals: readonly EvidenceSignal[];

  // Only what could prove `symptomClass`, from `admissibleProofKinds`. v1 and v2 derive their
  // own kinds from `signals` and ignore this, so a row written under either still recomputes.
  readonly proofKinds: readonly EvidenceSignalKind[];

  readonly symptomClass: FindingClass;
};

export type EvidenceShapeSerialiser = (input: EvidenceShapeInput) => string;

export const EVIDENCE_SHAPE_SERIALISERS: ReadonlyMap<number, EvidenceShapeSerialiser> = new Map([
  [1, serialiseV1],
  [2, serialiseV2],
  [3, serialiseV3],
]);

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

// v2 drops `surfaceNormalisationVersion`. It is derived per-window from the events on the
// surface and goes null the moment they disagree, so every surface walked 2 → null → 3 across
// a normalisation rollout — three identities for one problem, with no code change (B-016).
// The version stays on the candidate and on the findings row as provenance.
function serialiseV2(input: EvidenceShapeInput): string {
  const shape: CanonicalObject = {
    v: 2,
    detector: input.detector,
    surface: assertNormalisedSurface(input.surface),
    signalKinds: input.signals.map((signal) => signal.kind),
    symptomClass: input.symptomClass,
  };

  return canonicalJson(shape);
}

// v3 replaces `signalKinds` with the kinds that could prove the class. Under v2 every kind the
// window contained was identity, so one straggler exception landing at 31s rather than 29s added
// `failure_uncorrelated` and minted a new identity for the same problem (B-015). The full kind
// list stays on the candidate and on the findings row as provenance.
function serialiseV3(input: EvidenceShapeInput): string {
  const shape: CanonicalObject = {
    v: 3,
    detector: input.detector,
    surface: assertNormalisedSurface(input.surface),
    proofKinds: [...input.proofKinds],
    symptomClass: input.symptomClass,
  };

  return canonicalJson(shape);
}

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
