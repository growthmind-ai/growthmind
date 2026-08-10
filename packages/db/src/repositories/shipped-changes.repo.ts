import {
  NO_CONTROL_LABEL,
  SHIPPED_UNMEASURED_OUTCOMES,
  URL_PATH_NORMALISATION_VERSION,
  isNormalisedUrlPath,
  type ShippedCorpusKind,
  type ShippedLeadCount,
  type ShippedReportClaim,
  type TenantContext,
} from "@growthmind/shared";
import { eq, inArray } from "drizzle-orm";
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

export interface ChooseLeadCountInput {
  readonly changeId: string;
  readonly leadCount: ShippedLeadCount;
}

export type ChooseLeadCountResult = { readonly kind: "chosen" | "already_read_out" };

export interface ReportShippedChangeResult {
  readonly claim: ShippedReportClaim;
  readonly change: ShippedChangeRow;
}

export interface ShippedChangesRepo {
  reportShipped(input: ReportShippedChangeInput): Promise<ReportShippedChangeResult>;

  // The state is the condition, so a press that lands after the readout moves nothing and says
  // so rather than editing what has already been answered.
  chooseLeadCount(input: ChooseLeadCountInput): Promise<ChooseLeadCountResult>;

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

// page_normalisation_version is stamped from the current constant, so a page that is not already
// the normaliser's own output would be stamped as normalised while matching nothing the spine
// holds. The same posture as computeFindingSignature's surface guard.
function assertNormalisedPage(page: string): void {
  if (isNormalisedUrlPath(page)) return;

  throw new Error(
    "shipped_changes.reportShipped refuses a page that is not already a normaliseUrlPath fixed " +
      "point: the row stamps the normalisation version, so the page must equal its own " +
      "normalised form before it can be written.",
  );
}

export function createShippedChangesRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): ShippedChangesRepo {
  const c = orgCrud(db, ctx, shippedChanges);
  const s = scoped(db, ctx);

  return {
    async reportShipped(input: ReportShippedChangeInput): Promise<ReportShippedChangeResult> {
      const parsed = reportShippedChangeSchema.parse(input);

      assertNormalisedPage(parsed.page);

      await s.assertProjectOwned(parsed.projectId, notOurProject);

      const controlLabel = parsed.control ?? NO_CONTROL_LABEL;

      const changeKey = [
        eq(shippedChanges.projectId, parsed.projectId),
        eq(shippedChanges.page, parsed.page),
        eq(shippedChanges.controlLabel, controlLabel),
      ];

      // Insert-first against the change-key index, never check-then-create: two concurrent
      // reports of one change leave one row and one clock (D6), and the arm that returns a row
      // is the arm that created it.
      const attempt = await c.claim(
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
          fetch: changeKey,
        },
      );

      if (attempt.claimed && attempt.row !== null) {
        return { claim: "reported", change: attempt.row };
      }

      // The state is the predicate, so the description a re-report carries can only land while
      // the change is still open. Rewriting it on a row already read out would hang the
      // founder's verdict off wording they never saw. The clock is never in the set.
      const reworded = await c.update(
        { description: parsed.description },
        ...changeKey,
        eq(shippedChanges.state, "reported"),
      );

      if (reworded !== null) {
        return { claim: "clock_unchanged", change: reworded };
      }

      // A separate predicate rather than a relaxation of the one above: only a row still waiting
      // on a verdict, whose readout could not measure anything, comes back to reported. A row
      // that was measured, or that already carries an answer, is never touched here.
      const reopened = await c.update(
        {
          description: parsed.description,
          reportedAt: parsed.reportedAt,
          readoutDueAt: parsed.readoutDueAt,
          state: "reported",
          readOutAt: null,
          readoutOutcome: null,
        },
        ...changeKey,
        eq(shippedChanges.state, "read_out"),
        inArray(shippedChanges.readoutOutcome, [...SHIPPED_UNMEASURED_OUTCOMES]),
      );

      if (reopened !== null) {
        return { claim: "watching_again", change: reopened };
      }

      const settled = await c.maybe(...changeKey);

      if (settled === null) {
        throw new Error(
          "shipped_changes.reportShipped: the change key conflicted and its row could not be read",
        );
      }

      // One reason we abandon for never reached a reader and the other was never read out at
      // all, so "I already answered" is false on both.
      if (settled.state === "abandoned") {
        return { claim: "stopped_watching", change: settled };
      }

      return { claim: "already_answered", change: settled };
    },

    async chooseLeadCount(input: ChooseLeadCountInput): Promise<ChooseLeadCountResult> {
      const moved = await c.update(
        { leadCount: input.leadCount },
        eq(shippedChanges.id, input.changeId),
        eq(shippedChanges.state, "reported"),
      );

      return { kind: moved === null ? "already_read_out" : "chosen" };
    },

    async findById(id: string): Promise<ShippedChangeRow | null> {
      return c.maybe(eq(shippedChanges.id, id));
    },
  };
}
