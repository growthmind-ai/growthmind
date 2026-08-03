import type { FixSpecPayload } from "@growthmind/core";
import type { TenantContext } from "@growthmind/shared";

import type { ScopedExecutor } from "./types";

// Declared here rather than derived from the Drizzle table, because the table itself
// lands in Wave 3. The column list is Decision R-8's.
export type FindingPayloadRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly findingId: string;
  readonly payloadVersion: number;
  readonly candidate: unknown;
  readonly signals: readonly unknown[];
  readonly createdAt: Date;
};

export interface UpsertFindingPayloadInput {
  readonly findingId: string;
  readonly payload: FixSpecPayload;
}

export interface FindingPayloadsRepo {
  upsertFor(input: UpsertFindingPayloadInput): Promise<FindingPayloadRow>;

  findForFinding(findingId: string): Promise<FindingPayloadRow | null>;
}

const NOT_IMPLEMENTED = "finding-payloads.repo: not implemented";

export function createFindingPayloadsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): FindingPayloadsRepo {
  void db;
  void ctx;

  return {
    upsertFor(input: UpsertFindingPayloadInput): Promise<FindingPayloadRow> {
      void input;
      throw new Error(NOT_IMPLEMENTED);
    },

    findForFinding(findingId: string): Promise<FindingPayloadRow | null> {
      void findingId;
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
