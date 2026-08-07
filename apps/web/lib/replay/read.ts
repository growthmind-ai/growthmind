import {
  companyFacet,
  entryFacet,
  laneFacet,
  selectReplaySessions,
  tailNote,
  wayOut,
  type FacetOption,
  type ReplayListRow,
  type ReplayOutcome,
  type ReplayProvenance,
} from "@growthmind/core";
import {
  createProjectConnectionsRepo,
  createSessionsRepo,
  findFirstProjectForOrg,
  type SessionRecord,
  type SessionsRepo,
} from "@growthmind/db";
import { REPLAY_LANES, logger } from "@growthmind/shared";
import type { ReplayFilters, ReplaySessionFact, TenantContext } from "@growthmind/shared";

import type { ReplayRouteDeps } from "./deps";

// The route's own local constant, carried forward from GROUPABLE_SESSION_READ_CAP in the
// /companies list route this sprint deleted, with its justification unchanged: not imported from
// packages/core, because this is a read-page bound (how many rows one screen can group), not a
// pipeline magnitude.
export const REPLAY_SCREEN_READ_CAP = 500;

// The who-counts panel renders its three lanes whether or not R2 answered, so its counts are
// nullable where the two list facets' are not: a missing count is not a wrong count.
export interface ReplayLaneCount {
  readonly value: string;
  readonly sessionCount: number | null;
  readonly replayCount: number | null;
}

export interface ReplayFacets {
  readonly company: readonly FacetOption[];
  readonly entry: readonly FacetOption[];
  readonly whoCounts: readonly ReplayLaneCount[];
}

export type ReplayScreen =
  | { readonly kind: "signed_out" }
  | { readonly kind: "not_connected" }
  // The filters come back so E10's retry re-runs the query that failed rather than dropping the
  // reader back to an unfiltered screen, which would be a second failure.
  | { readonly kind: "failed"; readonly filters: ReplayFilters }
  | {
      readonly kind: "screen";
      readonly rows: readonly ReplayListRow[];
      readonly provenance: ReplayProvenance;
      readonly tailNote: string | null;
      readonly facets: ReplayFacets;
      readonly truncated: boolean;
      readonly outcome: ReplayOutcome;
    };

interface BoundedFacts {
  readonly facts: readonly ReplaySessionFact[];
  readonly truncated: boolean;
}

// Every meta number crosses as number-or-null, unmultiplied and uncoalesced: null is unmeasured
// and 0 is a measurement, and both seconds columns are seconds on either side of this map.
function factOf(record: SessionRecord): ReplaySessionFact {
  return {
    sessionKey: record.sessionKey,
    startedAt: record.startedAt,
    identityEmailDomain: record.identityEmailDomain,
    entryUrlPath: record.entryUrlPath,
    origin: record.origin,
    exclusionReason: record.exclusionReason,
    durationSeconds: record.recordingDurationSeconds,
    activeSeconds: record.recordingActiveSeconds,
    clickCount: record.recordingClickCount,
    keypressCount: record.recordingKeypressCount,
    consoleErrorCount: record.recordingConsoleErrorCount,
  };
}

async function read(
  repo: SessionsRepo,
  projectId: string,
  lane: Parameters<SessionsRepo["listSessions"]>[0]["lane"],
  narrowing: { readonly company: string | null; readonly entry: string | null },
): Promise<BoundedFacts | null> {
  try {
    const bounded = await repo.listSessions(
      {
        projectId,
        lane,
        ...(narrowing.company === null ? {} : { identityEmailDomain: narrowing.company }),
        ...(narrowing.entry === null ? {} : { entryUrlPath: narrowing.entry }),
      },
      { limit: REPLAY_SCREEN_READ_CAP },
    );

    return { facts: bounded.sessions.map(factOf), truncated: bounded.truncated };
  } catch (error) {
    // A DrizzleQueryError's message, and so its stack, is built from the query and its bound
    // params, and those params are the customer's own domain and paths. Only a closed set goes out.
    logger.error("replays: a session read for the replay screen failed", {
      lane,
      code: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

const UNCOUNTED_LANES: readonly ReplayLaneCount[] = REPLAY_LANES.map((lane) => ({
  value: lane,
  sessionCount: null,
  replayCount: null,
}));

function matchesEntry(fact: ReplaySessionFact, filters: ReplayFilters): boolean {
  return filters.entry === null || fact.entryUrlPath === filters.entry;
}

function matchesCompany(fact: ReplaySessionFact, filters: ReplayFilters): boolean {
  return filters.company === null || fact.identityEmailDomain === filters.company;
}

// The picked value is one nobody in this org has ever carried. Cross-org, guessed and aged-out
// values all reach here identically, because the org predicate returned nothing and nothing
// above it knows why (A10). If any picked value IS in the data, the screen is over-filtered
// rather than pointed at a stranger, and the way out computes which filter to relax.
function everyPickedValueIsUnknown(filters: ReplayFilters, facets: ReplayFacets): boolean {
  const picked: readonly (readonly [string | null, readonly FacetOption[]])[] = [
    [filters.company, facets.company],
    [filters.entry, facets.entry],
  ];

  const active = picked.filter(([value]) => value !== null);

  return (
    active.length > 0 &&
    active.every(([value, options]) => !options.some((option) => option.value === value))
  );
}

function narrowed(filters: ReplayFilters): boolean {
  return filters.company !== null || filters.entry !== null;
}

function outcomeOf(input: {
  readonly filters: ReplayFilters;
  readonly facets: ReplayFacets;
  readonly rows: readonly ReplayListRow[];
  readonly provenance: ReplayProvenance;
  readonly relaxingCompany: readonly ReplaySessionFact[];
  readonly relaxingEntry: readonly ReplaySessionFact[];
  readonly relaxingLane: readonly ReplaySessionFact[];
}): ReplayOutcome {
  const { filters, provenance } = input;

  if (input.rows.length > 0) return "rows";

  // E6 is a fact rather than a wait: nothing simulates sessions yet, so the copy must not say
  // "yet" and invite a return to a zero that never moves.
  if (filters.lane === "simulated") return "simulated_permanent_zero";

  // E9 is a statement about the exclusion rules, so it may only be made about the whole lane: a
  // company or entry narrowed to zero hides rows the lane does hold, and the claim is then false.
  if (filters.lane === "excluded" && provenance.sessions === 0 && !narrowed(filters)) {
    return "nothing_left_out";
  }

  if (everyPickedValueIsUnknown(filters, input.facets)) return "value_matches_nothing";

  if (provenance.sessions > 0) return "zero_replays_for_selection";

  return wayOut({
    filters,
    relaxingCompany: input.relaxingCompany,
    relaxingEntry: input.relaxingEntry,
    relaxingLane: input.relaxingLane,
  });
}

// The single composition point for /replays, mirroring lib/findings/read.ts. The organization is
// resolved from the caller's context and never from `filters` — a client-supplied company value
// is only ever a value in a predicate.
export async function readReplayScreen(
  deps: ReplayRouteDeps,
  ctx: TenantContext | null,
  filters: ReplayFilters,
): Promise<ReplayScreen> {
  if (ctx === null) return { kind: "signed_out" };

  // Reading must not provision: this looks the org's first project up and never creates one.
  const project = await findFirstProjectForOrg(deps.db, ctx);
  if (project === undefined) return { kind: "not_connected" };

  // One query answers the connection question, with no source object built for it.
  const connection = await createProjectConnectionsRepo(deps.db, ctx).getActiveForProject(
    project.id,
  );
  if (connection === null) return { kind: "not_connected" };

  const repo = createSessionsRepo(deps.db, ctx);

  // R1 predicates on the lane alone so the list, both list facets and the provenance numbers
  // share one read; R2 is all-lanes under the picked company and entry so the who-counts panel
  // and the lane way-out share another. Neither serves the other's question (D-2).
  const [r1, r2] = await Promise.all([
    read(repo, project.id, filters.lane, { company: null, entry: null }),
    read(repo, project.id, "every_lane", { company: filters.company, entry: filters.entry }),
  ]);

  if (r1 === null) return { kind: "failed", filters };

  const { rows, provenance } = selectReplaySessions(r1.facts, filters);

  // An option's universe is built before the other filters are applied and its count after, so a
  // company holding nothing at the picked entry path stays in the list reading zero (AC-3). The
  // conditioned sets double as the way out's "what would relaxing this restore" passes.
  const relaxingCompany = r1.facts.filter((fact) => matchesEntry(fact, filters));
  const relaxingEntry = r1.facts.filter((fact) => matchesCompany(fact, filters));

  const facets: ReplayFacets = {
    company: companyFacet({ universe: r1.facts, conditioned: relaxingCompany }),
    entry: entryFacet({ universe: r1.facts, conditioned: relaxingEntry }),
    whoCounts:
      r2 === null ? UNCOUNTED_LANES : laneFacet({ universe: r2.facts, conditioned: r2.facts }),
  };

  return {
    kind: "screen",
    rows,
    provenance,
    tailNote: tailNote(provenance),
    facets,
    truncated: r1.truncated || (r2?.truncated ?? false),
    outcome: outcomeOf({
      filters,
      facets,
      rows,
      provenance,
      relaxingCompany,
      relaxingEntry,
      relaxingLane: r2?.facts ?? [],
    }),
  };
}
