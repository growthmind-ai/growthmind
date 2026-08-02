import type { FindingClass } from "../rules/types";

import { canonicalJson } from "../serialise/canonical-json";
import type { CanonicalObject } from "../serialise/canonical-json";

export const SIGNATURE_TUPLE_VERSION = 1;

export type SignatureTupleInput = {
  readonly projectId: string;

  readonly surfaceId: string;

  readonly symptomClass: FindingClass;

  readonly evidenceShape: string;
};

export type SignatureTupleSerialiser = (input: SignatureTupleInput) => string;

export const SIGNATURE_TUPLE_SERIALISERS: ReadonlyMap<number, SignatureTupleSerialiser> = new Map([
  [1, serialiseV1],
]);

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
