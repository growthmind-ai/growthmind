import {
  NO_CONTROL_LABEL,
  URL_PATH_NORMALISATION_VERSION,
  type ShippedCorpusKind,
  type TenantContext,
} from "@growthmind/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { orgCrud } from "./crud";
import { scoped } from "./scope";
import { shippedChanges } from "../schema/shipped-changes";
import type { ScopedExecutor } from "./types";

export type ShippedChangeRow = typeof shippedChanges.$inferSelect;

export interface ReportShippedChangeInput {
  readonly projectId: string;
  readonly page: string;
  readonly description: string;
  readonly reportedAt: Date;

  // Required with no default: a row that exists without a clock is a promise nobody can
  // grade, so the absence is refused here before any SQL runs.
  readonly readoutDueAt: Date;

  readonly control?: string;
}

export interface ShippedChangesRepo {
  reportShipped(input: ReportShippedChangeInput): Promise<ShippedChangeRow>;

  findById(id: string): Promise<ShippedChangeRow | null>;
}

// Non-strict on purpose: an extra key a caller casts in is stripped rather than trusted, so
// corpus_kind stays the product's derivation from the label.
const reportShippedChangeSchema = z.object({
  projectId: z.string().min(1),
  page: z.string().min(1),
  description: z.string().min(1),
  reportedAt: z.date(),
  readoutDueAt: z.date(),
  control: z.string().min(1).optional(),
});

function corpusKindFor(controlLabel: string): ShippedCorpusKind {
  return controlLabel === NO_CONTROL_LABEL ? "page" : "recorded";
}

function notOurProject(): Error {
  return new Error("shipped_changes.reportShipped: that project belongs to another organization");
}

export function createShippedChangesRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): ShippedChangesRepo {
  const c = orgCrud(db, ctx, shippedChanges);
  const s = scoped(db, ctx);

  return {
    async reportShipped(input: ReportShippedChangeInput): Promise<ShippedChangeRow> {
      const parsed = reportShippedChangeSchema.parse(input);

      await s.assertProjectOwned(parsed.projectId, notOurProject);

      const controlLabel = parsed.control ?? NO_CONTROL_LABEL;

      // One statement against the change-key index, never check-then-create: two concurrent
      // reports of one change leave one row and one clock (D6). The conflict arm updates the
      // description only, so the clock a re-report carries is discarded rather than applied.
      return c.insertOrFetch(
        {
          projectId: parsed.projectId,
          page: parsed.page,
          pageNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
          controlLabel,
          description: parsed.description,
          corpusKind: corpusKindFor(controlLabel),
          readoutDueAt: parsed.readoutDueAt,
          reportedAt: parsed.reportedAt,
        },
        {
          target: [
            shippedChanges.organizationId,
            shippedChanges.projectId,
            shippedChanges.page,
            shippedChanges.controlLabel,
          ],
          set: { description: parsed.description },
          fetch: [
            eq(shippedChanges.projectId, parsed.projectId),
            eq(shippedChanges.page, parsed.page),
            eq(shippedChanges.controlLabel, controlLabel),
          ],
        },
      );
    },

    async findById(id: string): Promise<ShippedChangeRow | null> {
      return c.maybe(eq(shippedChanges.id, id));
    },
  };
}
