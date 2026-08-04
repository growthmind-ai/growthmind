import type { FixSpecInput } from "@growthmind/core";
import type {
  FindingEvidence,
  FixStatus,
  McpMeasuredCount,
  TenantContext,
} from "@growthmind/shared";

export interface OpenFixRow {
  readonly fixId: string;
  readonly findingId: string;

  readonly summary: string;
  readonly impact: McpMeasuredCount;

  readonly openedAt: string;

  readonly resultsBy: string;
}

export interface FixRecord {
  readonly fixId: string;
  readonly findingId: string;
  readonly status: FixStatus;
  readonly spec: FixSpecInput;

  readonly attempt: number;

  readonly alreadyLanded: readonly string[];
  readonly impact: McpMeasuredCount;

  readonly resultsBy: string;
}

export interface FindingRecord {
  readonly findingId: string;

  readonly fixId: string | null;
  readonly headline: string;
  readonly detail: string;
  readonly surface: {
    readonly name: string;

    readonly path: string | null;
  };
  readonly affected: McpMeasuredCount;

  readonly firstSeenAt: string;

  readonly lastSeenAt: string;

  readonly evidence: readonly FindingEvidence[];
}

export interface ListOpenFixesQuery {
  readonly principal: TenantContext;

  readonly projectId: string | null;

  readonly limit: number;
}

export interface GetFixQuery {
  readonly principal: TenantContext;
  readonly fixId: string;
}

export interface GetFindingQuery {
  readonly principal: TenantContext;
  readonly findingId: string;
}

export interface OpenFixPage {
  readonly fixes: readonly OpenFixRow[];
  readonly totalOpen: number;
}

export interface SurfaceNoteRow {
  readonly surface: string;

  readonly matters: string;
  readonly confirmedByAPerson: boolean;
}

export interface KnownProblemRow {
  readonly findingId: string;
  readonly fixId: string | null;
  readonly headline: string;
  readonly affected: McpMeasuredCount;

  readonly lastSeenAt: string;
}

export interface DeclinedIdeaRow {
  readonly headline: string;

  readonly declinedAt: string;
}

export interface GrowthContextRecord {
  readonly projectId: string;
  readonly surface: string | null;

  readonly changeable: { readonly allowed: boolean; readonly reason: string | null } | null;
  readonly whatMatters: readonly SurfaceNoteRow[];
  readonly knownProblems: readonly KnownProblemRow[];
  readonly declined: readonly DeclinedIdeaRow[];
}

export interface GetGrowthContextQuery {
  readonly principal: TenantContext;

  readonly surface: string | null;

  readonly projectId: string | null;
}

export type GrowthContextAnswer =
  | { readonly outcome: "answered"; readonly record: GrowthContextRecord }
  | { readonly outcome: "no_project" }
  | { readonly outcome: "ambiguous_project"; readonly projectIds: readonly string[] };

export interface McpReadPort {
  listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage>;
  getFix(query: GetFixQuery): Promise<FixRecord | null>;
  getFinding(query: GetFindingQuery): Promise<FindingRecord | null>;
  getGrowthContext(query: GetGrowthContextQuery): Promise<GrowthContextAnswer>;
}

export function createAbsentReadPort(log: (message: string) => void): McpReadPort {
  let announced = false;

  const announceOnce = (): void => {
    if (announced) return;
    announced = true;
    log(
      "mcp: nothing on this installation records findings or fixes yet, so every read answers empty",
    );
  };

  return {
    listOpenFixes(): Promise<OpenFixPage> {
      announceOnce();
      return Promise.resolve({ fixes: [], totalOpen: 0 });
    },
    getFix(): Promise<FixRecord | null> {
      announceOnce();
      return Promise.resolve(null);
    },
    getFinding(): Promise<FindingRecord | null> {
      announceOnce();
      return Promise.resolve(null);
    },
    getGrowthContext(): Promise<GrowthContextAnswer> {
      announceOnce();
      return Promise.resolve({ outcome: "no_project" });
    },
  };
}
