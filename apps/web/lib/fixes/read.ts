import { renderFixSpec, type FixSpec } from "@growthmind/core";
import { createEventsCounterService, createFixesService, type ScopedDb } from "@growthmind/db";
import {
  isAnalyticsAttached,
  logger,
  toOnboardingCounterView,
  type TenantContext,
} from "@growthmind/shared";

import { tryRead, type Read } from "@/lib/read-or-fallback";
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
// presses the button in Slack, so this is a safety rail rather than a page size. `totalOpen`
// travels beside the rows, so the list says out of how many whenever it bites.
// Ratified 2026-08-07, see .ai/decisions/0022-record-page-display-limits.md
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
  | { readonly kind: "nothing_measured" }
  // The list read answered and is empty; the read that decides which of the two empties it is
  // did not. Stated rather than guessed: both guesses send someone the wrong way.
  | { readonly kind: "nothing_opened_unchecked" }
  | { readonly kind: "unavailable" };

async function analyticsAttached(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<Read<boolean>> {
  return tryRead(
    async () => {
      const counter = await createEventsCounterService(db, ctx).read(projectId);
      return isAnalyticsAttached(toOnboardingCounterView(counter).state.status);
    },
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
  const page = await tryRead(
    () => createFixesService(db, ctx).listOpen({ projectId, limit: FIX_LIST_LIMIT }),
    "fixes: the open list could not be read",
    { organizationId: ctx.organizationId, projectId },
  );

  if (!page.ok) {
    return { kind: "unavailable" };
  }

  if (page.value.rows.length === 0) {
    // Two empties, not one: "you have no fixes" and "we cannot see anything at all" have
    // different next actions, and merging them sends a new org looking for a Slack button
    // that will never appear. A third when we cannot tell them apart, for the same reason.
    const attached = await analyticsAttached(db, ctx, projectId);

    if (!attached.ok) {
      return { kind: "nothing_opened_unchecked" };
    }

    return attached.value ? { kind: "nothing_opened" } : { kind: "nothing_measured" };
  }

  // Painted in the order served. The service ranked on surface weights it owns, and a
  // second sort here would stop agreeing the day the weight table is versioned up.
  const ranked: readonly RankedRow[] = page.value.rows;

  const rows: readonly FixRowView[] = page.value.rows.map((row, index) => ({
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
    totalOpen: page.value.totalOpen,
    lateCount: rows.filter((row) => row.due.late).length,
  };
}

export type FixDetailView =
  | { readonly kind: "missing" }
  // Never folded into `missing`: a fix we could not fetch must not answer what an id that
  // never existed answers, or a Slack link lands on a 404 for a fix that is sitting there.
  | { readonly kind: "unavailable" }
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
  const result = await tryRead(
    () => createFixesService(db, ctx).readFix(fixId),
    "fixes: the fix behind this page could not be read",
    { fixId, organizationId: ctx.organizationId },
  );

  if (!result.ok) {
    return { kind: "unavailable" };
  }

  // A fix another organization owns answers `not_found` too, identically to an id that
  // never existed — a separate answer here would confirm the row exists (D7).
  if (result.value.outcome === "not_found") {
    return { kind: "missing" };
  }

  if (result.value.outcome === "unrenderable") {
    return { kind: "held", findingId: result.value.findingId };
  }

  const { fix, spec, impact } = result.value.read;

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
