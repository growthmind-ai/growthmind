import { z } from "zod";

import { measuredCount, measuredCountInputSchema } from "../counts/measured-count";
import type { MeasuredCount } from "../counts/measured-count";
import { claimSubjectSchema, detectorCoverageSchema } from "../detect/types";
import type { EvidenceSignal } from "../evidence/signals";
import { downgradeTraceSchema } from "../evidence/trace";
import { candidateFindingSchema, confidenceBasisSchema } from "../findings/candidate";
import type { CandidateFinding } from "../findings/candidate";
import { detectorNameSchema, findingClassSchema } from "../rules/types";
import { fixSpecInputSchema } from "./fix-spec";
import type { FixSpecInput } from "./fix-spec";

export const FIX_SPEC_PAYLOAD_VERSION = 1;

export type FixSpecPayload = {
  readonly payloadVersion: number;

  readonly candidate: unknown;

  readonly signals: readonly unknown[];
};

export class UnknownFixSpecPayloadVersionError extends Error {
  override readonly name = "UnknownFixSpecPayloadVersionError";

  readonly payloadVersion: unknown;

  constructor(payloadVersion: unknown) {
    super(
      `fix_spec_payload_unknown_version: this payload was written under version ` +
        `${String(payloadVersion)}, and only version ${String(FIX_SPEC_PAYLOAD_VERSION)} can be read`,
    );
    this.payloadVersion = payloadVersion;
  }
}

const persistedWindowSchema = z.object({ start: z.coerce.date(), end: z.coerce.date() });

// The brand is a `unique symbol`, so no persisted count survives `measuredCountSchema`.
// Everything read back through this module is re-minted by `measuredCount()`.
const persistedCountSchema = measuredCountInputSchema.extend({ timeframe: persistedWindowSchema });

const persistedSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("failure_correlated"),
    eventName: z.string().min(1),
    occurredAt: z.coerce.date(),
    precedingActionName: z.string().min(1),
    correlationWindowMs: z.number().int().nonnegative(),
    correlatedSessions: persistedCountSchema,
  }),
  z.object({
    kind: z.literal("failure_uncorrelated"),
    eventName: z.string().min(1),
    occurredAt: z.coerce.date(),
  }),
  z.object({
    kind: z.literal("struggle"),
    subkind: z.enum(["repeated_attempt", "backtrack"]),
    surface: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    strugglingSessions: persistedCountSchema,
  }),
  z.object({
    kind: z.literal("clean_exit"),
    surface: z.string().min(1),
  }),
  z.object({
    kind: z.literal("instrumentation_rate_drop"),
    eventName: z.string().min(1),
    observed: persistedCountSchema,
    expected: persistedCountSchema,
  }),
]);

type PersistedSignal = z.infer<typeof persistedSignalSchema>;

const persistedCandidateSchema = z.object({
  detector: detectorNameSchema,
  claimedClass: findingClassSchema,
  finalClass: findingClassSchema,
  trace: downgradeTraceSchema,
  counts: z.array(persistedCountSchema).min(1),
  timeframe: persistedWindowSchema,
  signals: z.array(persistedSignalSchema).default([]),
  claimSubject: claimSubjectSchema,
  surface: z.string().min(1),
  surfaceNormalisationVersion: z.number().int().nullable(),
  evidenceShape: z.string().min(1),
  evidenceShapeVersion: z.number().int().positive(),
  thresholdRuleSetVersion: z.number().int().positive(),
  ranking: z.object({
    sampleSize: persistedCountSchema,
    confidenceBasis: confidenceBasisSchema,
  }),
  coverage: detectorCoverageSchema,
});

const payloadEnvelopeSchema = z.object({
  payloadVersion: z.unknown(),
  candidate: z.unknown(),
  signals: z.array(z.unknown()),
});

function serialiseCount(count: MeasuredCount): unknown {
  return {
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    timeframe: {
      start: count.timeframe.start.toISOString(),
      end: count.timeframe.end.toISOString(),
    },
    basis: {
      totalInWindow: count.basis.totalInWindow,
      kept: count.basis.kept,
      setAside: count.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
  };
}

function serialiseSignal(signal: EvidenceSignal): unknown {
  switch (signal.kind) {
    case "failure_correlated":
      return {
        kind: signal.kind,
        eventName: signal.eventName,
        occurredAt: signal.occurredAt.toISOString(),
        precedingActionName: signal.precedingActionName,
        correlationWindowMs: signal.correlationWindowMs,
        correlatedSessions: serialiseCount(signal.correlatedSessions),
      };
    case "failure_uncorrelated":
      return {
        kind: signal.kind,
        eventName: signal.eventName,
        occurredAt: signal.occurredAt.toISOString(),
      };
    case "struggle":
      return {
        kind: signal.kind,
        subkind: signal.subkind,
        surface: signal.surface,
        attempts: signal.attempts,
        strugglingSessions: serialiseCount(signal.strugglingSessions),
      };
    case "clean_exit":
      return { kind: signal.kind, surface: signal.surface };
    case "instrumentation_rate_drop":
      return {
        kind: signal.kind,
        eventName: signal.eventName,
        observed: serialiseCount(signal.observed),
        expected: serialiseCount(signal.expected),
      };
  }
}

function serialiseCandidate(candidate: CandidateFinding): unknown {
  return {
    detector: candidate.detector,
    claimedClass: candidate.claimedClass,
    finalClass: candidate.finalClass,
    trace: candidate.trace.map((entry) => ({
      class: entry.class,
      predicate: entry.predicate,
      predicateVersion: entry.predicateVersion,
      satisfied: entry.satisfied,
      reasonCode: entry.reasonCode,
      reason: entry.reason,
    })),
    counts: candidate.counts.map(serialiseCount),
    timeframe: {
      start: candidate.timeframe.start.toISOString(),
      end: candidate.timeframe.end.toISOString(),
    },
    signals: candidate.signals.map(serialiseSignal),
    claimSubject: candidate.claimSubject,
    surface: candidate.surface,
    surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
    evidenceShape: candidate.evidenceShape,
    evidenceShapeVersion: candidate.evidenceShapeVersion,
    thresholdRuleSetVersion: candidate.thresholdRuleSetVersion,
    ranking: {
      sampleSize: serialiseCount(candidate.ranking.sampleSize),
      confidenceBasis: candidate.ranking.confidenceBasis,
    },
    coverage: {
      truncated: candidate.coverage.truncated,
      eventsWithoutUrlPath: candidate.coverage.eventsWithoutUrlPath,
    },
  };
}

function rehydrateSignal(signal: PersistedSignal): EvidenceSignal {
  switch (signal.kind) {
    case "failure_correlated":
      return { ...signal, correlatedSessions: measuredCount(signal.correlatedSessions) };
    case "failure_uncorrelated":
      return signal;
    case "struggle":
      return { ...signal, strugglingSessions: measuredCount(signal.strugglingSessions) };
    case "clean_exit":
      return signal;
    case "instrumentation_rate_drop":
      return {
        ...signal,
        observed: measuredCount(signal.observed),
        expected: measuredCount(signal.expected),
      };
  }
}

function rehydrateCandidate(candidate: unknown): CandidateFinding {
  const persisted = persistedCandidateSchema.parse(candidate);

  return candidateFindingSchema.parse({
    ...persisted,
    counts: persisted.counts.map((count) => measuredCount(count)),
    signals: persisted.signals.map(rehydrateSignal),
    ranking: {
      sampleSize: measuredCount(persisted.ranking.sampleSize),
      confidenceBasis: persisted.ranking.confidenceBasis,
    },
  });
}

export function serialiseFixSpecInput(input: FixSpecInput): FixSpecPayload {
  const parsed = fixSpecInputSchema.parse(input);

  return {
    payloadVersion: FIX_SPEC_PAYLOAD_VERSION,
    candidate: serialiseCandidate(parsed.candidate),
    signals: parsed.signals.map(serialiseSignal),
  };
}

export function rehydrateFixSpecInput(payload: unknown): FixSpecInput {
  const envelope = payloadEnvelopeSchema.parse(payload);

  if (envelope.payloadVersion !== FIX_SPEC_PAYLOAD_VERSION) {
    throw new UnknownFixSpecPayloadVersionError(envelope.payloadVersion);
  }

  return {
    candidate: rehydrateCandidate(envelope.candidate),
    signals: envelope.signals.map((signal) => rehydrateSignal(persistedSignalSchema.parse(signal))),
  };
}

export function toMeasuredCount(row: unknown): MeasuredCount {
  return measuredCount(persistedCountSchema.parse(row));
}
