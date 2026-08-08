import * as core from "../../src/index";
import type { SessionAction } from "../../src/replay/types";
import { canonicalJson } from "../../src/serialise/canonical-json";
import type { CanonicalValue } from "../../src/serialise/canonical-json";

export type PersistedElement = {
  readonly nodeId: number;
  readonly tag: string;
  readonly id?: string;
  readonly testId?: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly classes: readonly string[];
};

export type PersistedSessionAction = {
  readonly kind: string;
  readonly atMs: number;
  readonly element?: PersistedElement;
  readonly href?: string;
  readonly clicks?: number;
  readonly spanMs?: number;
  readonly focusCount?: number;
  readonly durationMs?: number;
};

export type PersistedTranscript = {
  readonly v: number;
  readonly actions: readonly PersistedSessionAction[];
};

export type SerialisePersistedTranscript = (
  actions: readonly SessionAction[],
  version: number,
) => PersistedTranscript;

export type ReadPersistedTranscript = (value: unknown) => PersistedTranscript | null;

const MISSING = (name: string, shape: string): string =>
  `@growthmind/core exports no ${name}. ADD §4.1 requires ` +
  `packages/core/src/replay/persisted-transcript.ts to declare ${shape} and src/index.ts to ` +
  `export it beside the existing replay exports.`;

function exported(name: string): unknown {
  return (core as unknown as Record<string, unknown>)[name];
}

export function serialiserUnderContract(): SerialisePersistedTranscript {
  const found = exported("serialisePersistedTranscript");

  if (typeof found !== "function") {
    throw new Error(
      MISSING("serialisePersistedTranscript", "serialisePersistedTranscript(actions, version)"),
    );
  }

  return found as SerialisePersistedTranscript;
}

export function readerUnderContract(): ReadPersistedTranscript {
  const found = exported("readPersistedTranscript");

  if (typeof found !== "function") {
    throw new Error(MISSING("readPersistedTranscript", "readPersistedTranscript(value: unknown)"));
  }

  return found as ReadPersistedTranscript;
}

export function numberConstantUnderContract(name: string): number {
  const found = exported(name);

  if (typeof found !== "number") {
    throw new Error(MISSING(name, `a numeric ${name}`));
  }

  return found;
}

export function bytesOf(transcript: PersistedTranscript): string {
  return canonicalJson(transcript as unknown as CanonicalValue);
}
