import type { FixSpecInput } from "@growthmind/core";
import {
  isNormalisedUrlPath,
  mcpMeasuredCountSchema,
  type FindingEvidence,
  type FixStatus,
  type McpMeasuredCount,
} from "@growthmind/shared";

import type { FindingRecord, FixRecord, OpenFixRow } from "./read-port";

// Every timestamp below is read off a persisted row, and a jsonb column carries every shape
// ever written into it, so the declared type of one is a claim rather than a guarantee.
export interface PersistedCount {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: "sessions";
  readonly timeframe: { readonly start: unknown; readonly end: unknown };
  readonly basis: {
    readonly totalInWindow: number;
    readonly kept: number;
    readonly setAside: readonly {
      readonly reason: string;
      readonly count: number;
      readonly label: string;
    }[];
  };
}

export interface PersistedOpenFix {
  readonly fixId: string;
  readonly findingId: string;
  readonly summary: string;
  readonly impact: PersistedCount;
  readonly openedAt: unknown;
  readonly resultsBy: unknown;
}

export interface PersistedFix {
  readonly fixId: string;
  readonly findingId: string;
  readonly status: FixStatus;
  readonly spec: FixSpecInput;
  readonly attempt: number;
  readonly alreadyLanded: unknown;
  readonly impact: PersistedCount;
  readonly resultsBy: unknown;
}

export interface PersistedFinding {
  readonly findingId: string;
  readonly fixId: string | null;
  readonly headline: string;
  readonly detail: string;
  readonly surface: string;
  readonly affected: PersistedCount;
  readonly firstSeenAt: unknown;
  readonly lastSeenAt: unknown;
  readonly evidence: readonly FindingEvidence[];
}

export function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  throw new Error(`mcp: a stored timestamp could not be read as a date (${typeof value})`);
}

function toStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

export function toMcpMeasuredCount(count: PersistedCount): McpMeasuredCount {
  return mcpMeasuredCountSchema.parse({
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    timeframe: { start: toIso(count.timeframe.start), end: toIso(count.timeframe.end) },
    basis: {
      totalInWindow: count.basis.totalInWindow,
      kept: count.basis.kept,
      setAside: count.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
  });
}

export function toOpenFixRow(row: PersistedOpenFix): OpenFixRow {
  return {
    fixId: row.fixId,
    findingId: row.findingId,
    summary: row.summary,
    impact: toMcpMeasuredCount(row.impact),
    openedAt: toIso(row.openedAt),
    resultsBy: toIso(row.resultsBy),
  };
}

export function toFixRecord(fix: PersistedFix): FixRecord {
  return {
    fixId: fix.fixId,
    findingId: fix.findingId,
    status: fix.status,
    spec: fix.spec,
    attempt: fix.attempt,
    alreadyLanded: toStrings(fix.alreadyLanded),
    impact: toMcpMeasuredCount(fix.impact),
    resultsBy: toIso(fix.resultsBy),
  };
}

export function toFindingRecord(finding: PersistedFinding): FindingRecord {
  return {
    findingId: finding.findingId,
    fixId: finding.fixId,
    headline: finding.headline,
    detail: finding.detail,
    // In this codebase a surface is a normalised URL path, so name and path are one value.
    surface: {
      name: finding.surface,
      path: isNormalisedUrlPath(finding.surface) ? finding.surface : null,
    },
    affected: toMcpMeasuredCount(finding.affected),
    firstSeenAt: toIso(finding.firstSeenAt),
    lastSeenAt: toIso(finding.lastSeenAt),
    evidence: finding.evidence,
  };
}
