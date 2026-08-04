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

export interface McpReadPort {
  listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage>;
  getFix(query: GetFixQuery): Promise<FixRecord | null>;
  getFinding(query: GetFindingQuery): Promise<FindingRecord | null>;
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
  };
}
