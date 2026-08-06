import { createFindingsRepo, type FindingRecord, type ScopedDb } from "@growthmind/db";
import { coverageSentences } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";
import type { FindingGroup, FindingRow, OverviewView } from "@growthmind/shared";

const FINDINGS_READ_LIMIT = 50;

const WITHHELD_HEADLINE = "A finding we can't show you yet";

function groupOf(record: FindingRecord): FindingGroup {
  if (record.text.held) return "withheld";
  if (record.summarySource !== "model_rendered") return "measurement";

  // No claim ever cites a beat yet — the cause stage that produces claims (O-044) is not
  // built, so nothing persisted today can honestly earn "explained" (evidence-standard §1).
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

function rowFrom(record: FindingRecord): FindingRow {
  const { headline, context } = contentOf(record);
  const { numerator, denominator } = impactCountOf(record);

  return {
    id: record.id,
    group: groupOf(record),
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

  const rows = records.map((record) => rowFrom(record));

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
      explained: 0,
      described: groupOf(record) === "described" ? 1 : 0,
      withheld: groupOf(record) === "withheld" ? 1 : 0,
    }).join(" "),
    withheld: record.text.held,
  };
}
