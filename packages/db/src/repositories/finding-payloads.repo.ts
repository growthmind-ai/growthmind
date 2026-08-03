import type { FixSpecPayload } from "@growthmind/core";
import type { TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { findingPayloads } from "../schema/finding-payloads";
import { orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

export type FindingPayloadRow = typeof findingPayloads.$inferSelect;

export interface UpsertFindingPayloadInput {
  readonly findingId: string;
  readonly payload: FixSpecPayload;
}

export interface FindingPayloadsRepo {
  upsertFor(input: UpsertFindingPayloadInput): Promise<FindingPayloadRow>;

  findForFinding(findingId: string): Promise<FindingPayloadRow | null>;
}

export const FINDING_PAYLOAD_CONFLICT_TARGET = [
  findingPayloads.organizationId,
  findingPayloads.findingId,
];

export function createFindingPayloadsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): FindingPayloadsRepo {
  const c = orgCrud(db, ctx, findingPayloads);

  return {
    async upsertFor(input: UpsertFindingPayloadInput): Promise<FindingPayloadRow> {
      return c.insertOrFetch(
        {
          findingId: input.findingId,
          payloadVersion: input.payload.payloadVersion,
          candidate: input.payload.candidate,
          signals: input.payload.signals,
        },
        {
          target: FINDING_PAYLOAD_CONFLICT_TARGET,
          fetch: [eq(findingPayloads.findingId, input.findingId)],
        },
      );
    },

    async findForFinding(findingId: string): Promise<FindingPayloadRow | null> {
      return c.maybe(eq(findingPayloads.findingId, findingId));
    },
  };
}
