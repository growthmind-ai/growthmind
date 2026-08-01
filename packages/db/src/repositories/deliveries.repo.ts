// Repository for the `deliveries` table (— "duplicate delivery is idempotent" and "a
// Slack delivery failure never breaks the pipeline's persisted state").
//
// Org-scoped at construction, no organization id parameter on any method
// (`__tests__/repositories/no-org-param.test.ts` enforces it structurally), and every
// mutation is keyed on the full unique tuple `(organization_id, finding_id,
// channel_id)`. There is no id-only write path onto this table, so a client-supplied
// delivery id can never reach another org's row.
import type { DeliveryStatus, TenantContext } from "@growthmind/shared";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import { deliveries } from "../schema/deliveries";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

export type DeliveryRecord = typeof deliveries.$inferSelect;

export interface ClaimDeliveryInput {
  readonly projectId: string;
  readonly findingId: string;
  /** Carried onto the row so delivery history resolves without joining `findings` (see
   * the schema header). */
  readonly signature: SignatureHex;
  /** The delivery address, a Slack channel id today. */
  readonly channelId: string;
  readonly claimedAt: Date;
}

/**
 * The answer to "do I own this post?". The only question a caller may act on before
 * talking to Slack.
 *
 * `claimed: true` means this caller inserted the row (or re-claimed a failed one) and
 * is the single owner of the post. `claimed: false` means someone else already owns it.
 * Another scheduler tick, a Graphile Worker retry of a job that already got as far as
 * posting, a duplicate webhook. A caller that posts on `claimed: false` is the
 * double-post bug this table exists to prevent.
 *
 * On `claimed: false`, `delivery` carries the row that beat us, so the caller can tell
 * "already posted" from "someone is mid-post" without a second query. It is `null` only
 * in the pathological case where that row vanished between the conflict and the read
 * (an org/project cascade landing in the gap). That degrades to "not mine, nothing to
 * report" rather than throwing: an exception on a bookkeeping edge inside the delivery
 * lane is the failure. A side-effect concern taking down the flow that called it.
 */
export type ClaimDeliveryResult =
  | { readonly claimed: true; readonly delivery: DeliveryRecord }
  | { readonly claimed: false; readonly delivery: DeliveryRecord | null };

export interface MarkPostedInput {
  readonly findingId: string;
  readonly channelId: string;
  readonly postedAt: Date;
  /** The channel's identifier for the message (a Slack `ts`), or `null` for an adapter
   * that has none. */
  readonly messageRef: string | null;
}

export interface MarkFailedInput {
  readonly findingId: string;
  readonly channelId: string;
  readonly failedAt: Date;
  /** Plain English, and never an echo of the message body. See the schema header on
   * `failure_reason`. */
  readonly reason: string;
}

export interface DeliveriesRepo {
  /**
   * The atomic claim. One statement:
   *
   *  INSERT INTO deliveries VALUES
   *  ON CONFLICT (organization_id, finding_id, channel_id) DO UPDATE
   *  Set status = 'pending', attempts = deliveries.attempts + 1,...
   *  WHERE deliveries.status = 'failed'
   * Returning *
   *
   * The unique index IS the lock. There is no "does a delivery already exist?" read
   * before it, so two concurrent claims for the same finding cannot both come back
   * owning the post: one inserts, the other conflicts, and the `WHERE deliveries.status
   * = 'failed'` guard means the conflicting statement updates nothing and returns
   * nothing for a row that is `pending` (someone is mid-post) or `posted` (it already
   * went out).
   *
   * A `failed` row IS re-claimable. That is the clause made operational: a failure
   * leaves the finding deliverable, and the retry lands on the same row (attempts
   * incremented, the stale failure cleared) rather than minting a second one that could
   * post twice.
   */
  claimForPost(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult>;
  /**
   * Terminal state `posted`. `posted_at` and `message_ref` are stamped with
   * `coalesce` so a replayed confirmation never moves the first-post instant or
   * overwrites the reference of the message that actually shipped. Returns `null` when
   * no row matches this org's `(finding_id, channel_id)`. A foreign org's delivery is
   * not found, not updated.
   */
  markPosted(input: MarkPostedInput): Promise<DeliveryRecord | null>;
  /**
   * Terminal state `failed`, carrying a plain-English reason. Guarded with `status <>
   * 'posted'`: a late failure signal arriving after Slack accepted the message must not
   * rewrite the row to `failed`, because a failed row is re-claimable and the retry
   * would post the finding a second time.
   *
   * Returns `null` when nothing was changed. Either the row is not this org's, or it is
   * already `posted`. Both mean the same thing to a caller: you did not just record a
   * failure, so do not act as if you did.
   */
  markFailed(input: MarkFailedInput): Promise<DeliveryRecord | null>;
  /** Org-filtered lookup on the same `(organization_id, finding_id, channel_id)` tuple
   * the claim conflicts on, `null` for a delivery that does not exist or belongs to
   * another org. */
  findFor(findingId: string, channelId: string): Promise<DeliveryRecord | null>;
  /**
   * Org- and project-filtered lookup by signature, newest claim first: "have we already
   * delivered this identity, and where?", answered without joining `findings`.
   *
   * `projectId` narrows this query (the trap `dismissals.repo.ts`'s
   * `findLatestForSignature` already paid for): a parameter that looks like a scope
   * narrowing and is silently discarded would answer a caller from another project's
   * history.
   */
  findLatestForSignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<DeliveryRecord | null>;
  /**
   * Every delivery still `pending` for a project. The scheduler's "is one already
   * open?" read.
   *
   * This is why the terminal-write rule is load-bearing rather than tidy: a row left
   * `pending` because some exit path forgot to record `posted` or `failed` shows up
   * here forever, and the scheduler answers `nothing_today` with reason
   * `one_already_open` on every tick from then on. The lane jams silently, with no
   * error anywhere.
   */
  listPendingForProject(projectId: string): Promise<DeliveryRecord[]>;
}

/** The unique-index tuple every delivery claim conflicts on. */
export const DELIVERY_CONFLICT_TARGET = [
  deliveries.organizationId,
  deliveries.findingId,
  deliveries.channelId,
];

/** The status a conflicting row must be in for a re-claim to be allowed. */
const RE_CLAIMABLE_STATUS: DeliveryStatus = "failed";

export function createDeliveriesRepo(db: ScopedDb, ctx: TenantContext): DeliveriesRepo {
  /** Scoped by the full unique tuple, never by primary key alone, so no id-only
   * mutation path onto this table exists. */
  function byTuple(findingId: string, channelId: string) {
    return and(
      eq(deliveries.organizationId, ctx.organizationId),
      eq(deliveries.findingId, findingId),
      eq(deliveries.channelId, channelId),
    );
  }

  return {
    async claimForPost(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult> {
      // One statement decides ownership. No prior read means no window in which two
      // callers both conclude "nothing here yet, I'll post".
      const [claimed] = await db
        .insert(deliveries)
        .values({
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          findingId: input.findingId,
          signature: input.signature,
          channelId: input.channelId,
          status: "pending",
          claimedAt: input.claimedAt,
          attempts: 1,
        })
        .onConflictDoUpdate({
          target: DELIVERY_CONFLICT_TARGET,
          // Only a failed row may be re-claimed. For a `pending` or `posted` row this
          // predicate is false, the update touches nothing, and `RETURNING` yields no
          // row, which is precisely how the caller learns it does not own the post.
          setWhere: eq(deliveries.status, RE_CLAIMABLE_STATUS),
          set: {
            status: "pending",
            claimedAt: input.claimedAt,
            // Incremented IN SQL (never read-then-write). A blocked duplicate claim
            // never reaches this clause, so the counter means "real attempts", not
            // "times asked".
            attempts: sql`${deliveries.attempts} + 1`,
            // The row describes the current attempt; the previous attempt's failure is
            // cleared rather than left to read as live state.
            failedAt: null,
            failureReason: null,
          },
        })
        .returning();

      if (claimed) {
        return { claimed: true, delivery: claimed };
      }

      // We lost. Read back whoever owns it, under our own org filter. The conflicting
      // row is ours by construction (we inserted `ctx.organizationId`), so this can
      // never surface another tenant's row.
      const [existing] = await db
        .select()
        .from(deliveries)
        .where(byTuple(input.findingId, input.channelId))
        .limit(1);

      return { claimed: false, delivery: existing ?? null };
    },

    async markPosted(input: MarkPostedInput): Promise<DeliveryRecord | null> {
      const [row] = await db
        .update(deliveries)
        .set({
          status: "posted",
          // `coalesce`, a replayed confirmation never moves the first-post
          // instant, and never overwrites the reference of the message that actually
          // shipped.
          postedAt: sql`coalesce(${deliveries.postedAt}, ${input.postedAt})`,
          messageRef: sql`coalesce(${deliveries.messageRef}, ${input.messageRef}::text)`,
          // A success supersedes the previous attempt's failure; leaving it would make
          // a posted row read as failed to anyone scanning the reason column.
          failedAt: null,
          failureReason: null,
        })
        .where(byTuple(input.findingId, input.channelId))
        .returning();

      return row ?? null;
    },

    async markFailed(input: MarkFailedInput): Promise<DeliveryRecord | null> {
      // `status <> 'posted'` is the single most dangerous line in this file: without
      // it, a late failure signal would rewrite an already-posted delivery to `failed`,
      // the row would become re-claimable, and the retry would post the finding to the
      // customer a second time.
      const [row] = await db
        .update(deliveries)
        .set({
          status: "failed",
          failedAt: input.failedAt,
          failureReason: input.reason,
        })
        .where(and(byTuple(input.findingId, input.channelId), ne(deliveries.status, "posted")))
        .returning();

      return row ?? null;
    },

    async findFor(findingId: string, channelId: string): Promise<DeliveryRecord | null> {
      const [row] = await db
        .select()
        .from(deliveries)
        .where(byTuple(findingId, channelId))
        .limit(1);

      return row ?? null;
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DeliveryRecord | null> {
      // organization_id first, then the project the caller named, then the signature.
      // Every one of the three is stamped by `claimForPost` (stamp/filter symmetry).
      const [row] = await db
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.organizationId, ctx.organizationId),
            eq(deliveries.projectId, projectId),
            eq(deliveries.signature, signature),
          ),
        )
        .orderBy(desc(deliveries.claimedAt))
        .limit(1);

      return row ?? null;
    },

    async listPendingForProject(projectId: string): Promise<DeliveryRecord[]> {
      return db
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.organizationId, ctx.organizationId),
            eq(deliveries.projectId, projectId),
            eq(deliveries.status, "pending"),
          ),
        )
        .orderBy(desc(deliveries.claimedAt));
    },
  };
}
