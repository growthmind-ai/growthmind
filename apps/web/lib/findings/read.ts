import {
  createCauseClaimsRepo,
  createFindingsRepo,
  createRecordingSummariesRepo,
  type CauseClaimRecord,
  type FindingRecord,
  type ScopedDb,
} from "@growthmind/db";
import { coverageSentences } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";
import type {
  BeatView,
  ClaimView,
  FindingGroup,
  FindingRow,
  OverviewView,
} from "@growthmind/shared";

import { buildEvidenceView } from "./evidence";

const FINDINGS_READ_LIMIT = 50;

const WITHHELD_HEADLINE = "A finding we can't show you yet";

// The single place a finding's grade is derived (FR-12) — a finding earns "explained" iff a
// cause_claims row exists with at least one claim that survived the citation gate; every other
// shape (never attempted, gate emptied everything, model_rendered but no cause row, floor
// rendered, withheld) stays "described"/"measurement"/"withheld" as before.
function groupOf(record: FindingRecord, causeClaims: CauseClaimRecord | null): FindingGroup {
  if (record.text.held) return "withheld";
  if (record.summarySource !== "model_rendered") return "measurement";
  if (causeClaims !== null && causeClaims.claims.length > 0) return "explained";
  return "described";
}

function contentOf(record: FindingRecord): { headline: string; context: string } {
  if (record.text.held) return { headline: WITHHELD_HEADLINE, context: "" };

  return {
    headline: record.text.headline,
    context: record.text.context.join(" ").trim(),
  };
}

// The impact count is always the last row: COUNT_ROLES declares each detector's IMPACT_ROLE
// as its final role (packages/core/src/summary/count-roles.ts), and delivery-lane-source.ts
// reads the same row the same way.
function impactCountOf(record: FindingRecord): {
  numerator: number | null;
  denominator: number | null;
} {
  const last = record.counts[record.counts.length - 1];
  if (last === undefined) return { numerator: null, denominator: null };

  return { numerator: last.numerator, denominator: last.denominator };
}

function observedOnOf(record: FindingRecord): string {
  return record.windowEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function rowFrom(record: FindingRecord, causeClaims: CauseClaimRecord | null): FindingRow {
  const { headline, context } = contentOf(record);
  const { numerator, denominator } = impactCountOf(record);

  return {
    id: record.id,
    group: groupOf(record, causeClaims),
    headline,
    context,
    aside: null,
    numerator,
    denominator,
    observedOn: observedOnOf(record),
  };
}

function windowLabelOf(records: readonly FindingRecord[]): string {
  const latest = records[0];
  if (latest === undefined) return "No findings yet";

  const start = latest.windowStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const end = latest.windowEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${start} – ${end}`;
}

function coverageOf(records: readonly FindingRecord[], rows: readonly FindingRow[]) {
  const last = records[0]?.counts[records[0].counts.length - 1];

  return {
    sessionsRead: last?.basis.totalInWindow ?? 0,
    sessionsSetAside: last?.basis.setAside.reduce((sum, entry) => sum + entry.count, 0) ?? 0,
    found: rows.length,
    explained: rows.filter((row) => row.group === "explained").length,
    described: rows.filter((row) => row.group === "described").length,
    withheld: rows.filter((row) => row.group === "withheld").length,
  };
}

// No verdict ledger exists yet (O-028/O-029): every real read reports zero calibration calls,
// which is the honest zero-state calibrationSentence already renders, not a placeholder.
const NO_CALIBRATION = { right: 0, wrong: 0, pending: 0 };

export async function readLiveOverview(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<OverviewView> {
  const records = await createFindingsRepo(db, ctx).listForProject(projectId, {
    limit: FINDINGS_READ_LIMIT,
  });

  const causeClaimsByFinding = await createCauseClaimsRepo(db, ctx).findForFindings(
    projectId,
    records.map((record) => record.id),
  );

  const rows = records.map((record) =>
    rowFrom(record, causeClaimsByFinding.get(record.id) ?? null),
  );

  return {
    window: windowLabelOf(records),
    coverage: coverageOf(records, rows),
    calibration: NO_CALIBRATION,
    rows,
  };
}

export interface FindingDetailView {
  readonly id: string;
  readonly headline: string;
  readonly context: string;
  readonly countLine: string;
  readonly coverageLine: string;
  readonly withheld: boolean;

  readonly grade: "explained" | "described";
  readonly evidence: {
    readonly beats: readonly BeatView[];
    readonly claims: readonly ClaimView[];
    readonly droppedClaims: number;
  } | null;
}

function countLineOf(record: FindingRecord): string {
  const { numerator, denominator } = impactCountOf(record);
  const window = windowLabelOf([record]);

  if (numerator === null || denominator === null) return window;
  return `${String(numerator)} of ${String(denominator)} sessions · ${window}`;
}

export async function readLiveFinding(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
  id: string,
): Promise<FindingDetailView | null> {
  const record = await createFindingsRepo(db, ctx).findById(projectId, id);
  if (record === null) return null;

  const causeClaims = await createCauseClaimsRepo(db, ctx).findForFinding(projectId, record.id);
  const group = groupOf(record, causeClaims);

  const { headline, context } = contentOf(record);
  const last = record.counts[record.counts.length - 1];

  return {
    id: record.id,
    headline,
    context,
    countLine: countLineOf(record),
    coverageLine: coverageSentences({
      sessionsRead: last?.basis.totalInWindow ?? 0,
      sessionsSetAside: last?.basis.setAside.reduce((sum, entry) => sum + entry.count, 0) ?? 0,
      found: 1,
      explained: group === "explained" ? 1 : 0,
      described: group === "described" ? 1 : 0,
      withheld: group === "withheld" ? 1 : 0,
    }).join(" "),
    withheld: record.text.held,
    grade: group === "explained" ? "explained" : "described",
    evidence: await buildEvidenceView(record, causeClaims, (recordProjectId, sessionIds) =>
      createRecordingSummariesRepo(db, ctx).citationsFor(recordProjectId, sessionIds),
    ),
  };
}
