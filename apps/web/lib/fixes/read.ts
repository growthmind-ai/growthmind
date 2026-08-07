import { renderFixSpec, type FixSpec } from "@growthmind/core";
import { createEventsCounterService, createFixesService, type ScopedDb } from "@growthmind/db";
import {
  isAnalyticsAttached,
  logger,
  toOnboardingCounterView,
  type TenantContext,
} from "@growthmind/shared";

import { readOrFallback } from "@/lib/read-or-fallback";
import { ROUTES } from "@/lib/routes";

import {
  countOf,
  dueOf,
  explainRank,
  promiseOf,
  setAsideSentences,
  type FixRowView,
  type PromiseView,
  type RankedRow,
} from "./view";

// A finding is delivered at most three times a week and a fix only exists once someone
// presses the button in Slack, so this is a safety rail rather than a page size. The list
// says out of how many whenever it bites.
export const FIX_LIST_LIMIT = 25;

// Keyed on the fix's own id, not its finding's: `readFix(fixId)` is the only read that can
// tell "we hold this and cannot word it" apart from "no such fix", and a findingId cannot
// reach it. `lib/paths.ts`'s `fixPath` still takes a findingId, for the fixture pages.
export function fixDetailPath(fixId: string): string {
  return `${ROUTES.fixes}/${encodeURIComponent(fixId)}`;
}

export type FixesListView =
  | {
      readonly kind: "rows";
      readonly rows: readonly FixRowView[];
      readonly totalOpen: number;
      readonly lateCount: number;
    }
  | { readonly kind: "nothing_opened" }
  | { readonly kind: "nothing_measured" };

async function analyticsAttached(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<boolean> {
  return readOrFallback(
    async () => {
      const counter = await createEventsCounterService(db, ctx).read(projectId);
      return isAnalyticsAttached(toOnboardingCounterView(counter).state.status);
    },
    true,
    "fixes: the analytics connection could not be read for the empty state",
    { organizationId: ctx.organizationId },
  );
}

export async function readOpenFixes(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
  now: Date,
): Promise<FixesListView> {
  const page = await createFixesService(db, ctx).listOpen({ projectId, limit: FIX_LIST_LIMIT });

  if (page.rows.length === 0) {
    // Two empties, not one: "you have no fixes" and "we cannot see anything at all" have
    // different next actions, and merging them sends a new org looking for a Slack button
    // that will never appear.
    return (await analyticsAttached(db, ctx, projectId))
      ? { kind: "nothing_opened" }
      : { kind: "nothing_measured" };
  }

  // Painted in the order served. The service ranked on surface weights it owns, and a
  // second sort here would stop agreeing the day the weight table is versioned up.
  const ranked: readonly RankedRow[] = page.rows;

  const rows: readonly FixRowView[] = page.rows.map((row, index) => ({
    fixId: row.fixId,
    href: fixDetailPath(row.fixId),
    rank: index + 1,
    summary: row.summary,
    count: countOf(row.impact),
    due: dueOf(row.resultsBy, now),
    why: explainRank(row, index, ranked),
  }));

  return {
    kind: "rows",
    rows,
    totalOpen: page.totalOpen,
    lateCount: rows.filter((row) => row.due.late).length,
  };
}

export type FixDetailView =
  | { readonly kind: "missing" }
  | { readonly kind: "held"; readonly findingId: string }
  | {
      readonly kind: "contract";
      readonly findingId: string;
      readonly spec: FixSpec;
      readonly promise: PromiseView;
      readonly setAside: readonly string[];
    };

export async function readFixDetail(
  db: ScopedDb,
  ctx: TenantContext,
  fixId: string,
  now: Date,
): Promise<FixDetailView> {
  const result = await createFixesService(db, ctx).readFix(fixId);

  // A fix another organization owns answers `not_found` too, identically to an id that
  // never existed — a separate answer here would confirm the row exists (D7).
  if (result.outcome === "not_found") {
    return { kind: "missing" };
  }

  if (result.outcome === "unrenderable") {
    return { kind: "held", findingId: result.findingId };
  }

  const { fix, spec, impact } = result.read;

  try {
    return {
      kind: "contract",
      findingId: fix.findingId,
      spec: renderFixSpec(spec),
      promise: promiseOf(fix.openedAt, fix.resultsBy, now),
      setAside: setAsideSentences(impact),
    };
  } catch (error) {
    logger.error("fixes: a spec the service read back would not render on the page", {
      fixId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { kind: "held", findingId: fix.findingId };
  }
}
