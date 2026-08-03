import type { FixSpecInput, MeasuredCount } from "@growthmind/core";
import type { FindingEvidence, TenantContext } from "@growthmind/shared";

import type { FixRow } from "../repositories/fixes.repo";
import type { ScopedDb } from "../repositories/types";

export type OpenFixResult =
  | { readonly outcome: "opened"; readonly fix: FixRow }
  | { readonly outcome: "already_open"; readonly fix: FixRow }
  | { readonly outcome: "finding_not_found" }
  | { readonly outcome: "no_payload" }
  | { readonly outcome: "unrenderable" };

export interface OpenFixReadModel {
  readonly fixId: string;
  readonly findingId: string;

  readonly summary: string;
  readonly impact: MeasuredCount;
  readonly openedAt: Date;
  readonly resultsBy: Date;
}

export interface FixReadModel {
  readonly fix: FixRow;
  readonly spec: FixSpecInput;
  readonly impact: MeasuredCount;
}

export interface FindingReadModel {
  readonly findingId: string;
  readonly fixId: string | null;
  readonly headline: string;
  readonly detail: string;
  readonly surface: string;
  readonly affected: MeasuredCount;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly evidence: readonly FindingEvidence[];
}

export interface ListOpenFixesInput {
  readonly projectId: string | null;
  readonly limit: number;
}

export interface ListOpenFixesPage {
  readonly rows: OpenFixReadModel[];
  readonly totalOpen: number;
}

export interface FixesService {
  openFor(findingId: string): Promise<OpenFixResult>;

  readFix(fixId: string): Promise<FixReadModel | null>;

  readFinding(findingId: string): Promise<FindingReadModel | null>;

  listOpen(input: ListOpenFixesInput): Promise<ListOpenFixesPage>;
}

const NOT_IMPLEMENTED = "fixes.service: not implemented";

export function createFixesService(db: ScopedDb, ctx: TenantContext): FixesService {
  void db;
  void ctx;

  return {
    openFor(findingId: string): Promise<OpenFixResult> {
      void findingId;
      throw new Error(NOT_IMPLEMENTED);
    },

    readFix(fixId: string): Promise<FixReadModel | null> {
      void fixId;
      throw new Error(NOT_IMPLEMENTED);
    },

    readFinding(findingId: string): Promise<FindingReadModel | null> {
      void findingId;
      throw new Error(NOT_IMPLEMENTED);
    },

    listOpen(input: ListOpenFixesInput): Promise<ListOpenFixesPage> {
      void input;
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
