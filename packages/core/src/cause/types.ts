import type { TranscriptBeatKind } from "@growthmind/shared";

// One beat of a rehydrated transcript, shaped for the cause stage's model call
// (worker/src/analysis/cause.ts) and for the read-path BeatView builder
// (apps/web/lib/findings/evidence.ts) — both build this from the same
// beatsFromActions call, so a citation index means the same beat on both sides
// (ADD Decision 4).
export type CauseBeatEvidence = {
  readonly index: number;
  readonly atMs: number;
  readonly kind: TranscriptBeatKind;
  readonly text: string;

  readonly notable: boolean;
  readonly attempt: number | null;
};

// A claim that survived the citation gate (ADD Decision 6, gate 2). Never
// carries the beats it cites — only their indices into the caller's own
// beat list, re-derived at read time rather than duplicated (ADD Decision 3).
export type CauseClaim = {
  readonly statement: string;
  readonly citesBeats: readonly number[];
};
