import type { BeatView, ClaimView, FindingRow, OverviewView } from "@growthmind/shared";

import evidenceData from "./data/evidence.json";
import findingsData from "./data/findings.json";

export interface EvidenceSession {
  readonly id: string;
  readonly label: string;
  readonly beats: readonly BeatView[];
  readonly claims: readonly ClaimView[];
  readonly droppedClaims: number;
}

export interface EvidenceOrigin {
  readonly pullRequest: number;
  readonly title: string;
  readonly meta: string;
  readonly why: string;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly headline: string;
  readonly countLine: string;
  readonly coverageLine: string;
  readonly withheld: boolean;
  readonly cohortLine: string | null;
  readonly cohortNote: string | null;
  readonly cohortBeats: readonly BeatView[];
  readonly origin: EvidenceOrigin | null;
  readonly sessions: readonly EvidenceSession[];
}

const EVIDENCE = evidenceData as Readonly<Record<string, EvidenceRecord>>;

const ROWS = findingsData.rows as readonly FindingRow[];

export interface PreviewOverview extends OverviewView {
  readonly recalibration: string;
}

export function readOverview(dismissed: ReadonlySet<string>): PreviewOverview {
  const rows = ROWS.filter((row) => !dismissed.has(row.id));

  return {
    window: findingsData.window,
    calibration: findingsData.calibration,
    recalibration: findingsData.recalibration,
    coverage: {
      sessionsRead: findingsData.coverage.sessionsRead,
      sessionsSetAside: findingsData.coverage.sessionsSetAside,
      found: rows.length,
      explained: rows.filter((row) => row.group === "explained").length,
      described: rows.filter((row) => row.group === "described").length,
      withheld: rows.filter((row) => row.group === "withheld").length,
    },
    rows,
  };
}

export function readAllRows(): readonly FindingRow[] {
  return ROWS;
}

export function readRow(id: string): FindingRow | null {
  return ROWS.find((row) => row.id === id) ?? null;
}

export function readEvidence(id: string): EvidenceRecord | null {
  return EVIDENCE[id] ?? null;
}

export function pickSession(
  record: EvidenceRecord,
  requested: string | undefined,
): EvidenceSession | null {
  if (record.sessions.length === 0) return null;

  return (
    record.sessions.find((session) => session.id === requested) ??
    (record.sessions[0] as EvidenceSession)
  );
}

export function hasEvidence(id: string): boolean {
  return Object.hasOwn(EVIDENCE, id);
}
