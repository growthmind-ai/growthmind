import type { FixStatus, TenantContext } from "@growthmind/shared";

import type { ClaimResult } from "./crud";
import type { ScopedExecutor } from "./types";

// Declared here rather than derived from the Drizzle table, because the table itself
// lands in Wave 3. The column list is Decision R-8's.
export type FixRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly status: FixStatus;
  readonly attempt: number;
  readonly alreadyLanded: readonly string[];
  readonly resultsBy: Date;
  readonly resultsByRuleVersion: number;
  readonly openedAt: Date;
  readonly openedBy: string;
  readonly createdAt: Date;
};

export interface ClaimFixInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly openedAt: Date;
  readonly openedBy: string;
  readonly resultsBy: Date;
  readonly resultsByRuleVersion: number;
}

export interface ListOpenFixesOptions {
  readonly projectId: string | null;
  readonly limit: number;
}

export interface CountOpenFixesOptions {
  readonly projectId: string | null;
}

export interface FixesRepo {
  claimFor(input: ClaimFixInput): Promise<ClaimResult<FixRow>>;

  findById(fixId: string): Promise<FixRow | null>;

  findForFinding(findingId: string): Promise<FixRow | null>;

  listOpen(options: ListOpenFixesOptions): Promise<FixRow[]>;

  countOpen(options: CountOpenFixesOptions): Promise<number>;
}

const NOT_IMPLEMENTED = "fixes.repo: not implemented";

export function createFixesRepo(db: ScopedExecutor, ctx: TenantContext): FixesRepo {
  void db;
  void ctx;

  return {
    claimFor(input: ClaimFixInput): Promise<ClaimResult<FixRow>> {
      void input;
      throw new Error(NOT_IMPLEMENTED);
    },

    findById(fixId: string): Promise<FixRow | null> {
      void fixId;
      throw new Error(NOT_IMPLEMENTED);
    },

    findForFinding(findingId: string): Promise<FixRow | null> {
      void findingId;
      throw new Error(NOT_IMPLEMENTED);
    },

    listOpen(options: ListOpenFixesOptions): Promise<FixRow[]> {
      void options;
      throw new Error(NOT_IMPLEMENTED);
    },

    countOpen(options: CountOpenFixesOptions): Promise<number> {
      void options;
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
