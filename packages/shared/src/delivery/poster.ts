import { z } from "zod";

// The delivery poster port. Defined in `shared` for the same reason
// `../summary/types.ts` puts the `SummaryRenderer` port's shapes here:
// `packages/adapters` (the producer) depends only on `@growthmind/shared`, and `worker`
// (the consumer) depends on `adapters`, so `shared` is the one package both already
// reach, and the graph between them stays one-way.
//
// The port is deliberately not named for Slack. A vendor-named port would have to be
// renamed the day a second channel lands, which is the same stringly-typed hazard
// `worker/src/task-names.ts` documents for task identifiers. The adapter is
// Slack-specific; the port is not.

/**
 * Why a post attempt failed, keyed by mechanism rather than by the vendor's own error
 * type, the same split `summaryFailureCodeSchema` makes, and for the same reason: the
 * consumer branches on what it can DO about the failure, not on which library raised
 * it.
 *
 * `not_authorised` and `channel_unavailable` are separated from the generic
 * `call_failed` because they are the two that will not fix themselves on retry: a
 * revoked token and a deleted (or never-joined) channel both need a human, and a
 * delivery lane that retries them forever is a lane that never surfaces the one problem
 * a customer could actually act on.
 */
export const postFailureCodeSchema = z.enum([
  /** The call itself did not complete. Transport, timeout, or rate limit. Worth
   * retrying. */
  "call_failed",
  /** The channel rejected the message as posted. A malformed payload. Not worth
   * retrying unchanged. */
  "rejected",
  /** Our credentials were refused. A human has to reconnect; retrying cannot help. */
  "not_authorised",
  /** The channel is gone, archived, or we were never in it. A human has to pick another
   * one; retrying cannot help. */
  "channel_unavailable",
]);
export type PostFailureCode = z.infer<typeof postFailureCodeSchema>;

/**
 * Whether a failure can fix itself. Derived from the code rather than carried as a
 * separate boolean, so the two can never disagree. A boolean the adapter sets by hand
 * is a boolean that eventually contradicts its own code.
 */
export function isRetryablePostFailure(code: PostFailureCode): boolean {
  return code === "call_failed";
}

/**
 * The port's return value.
 *
 * `messageRef` on the success arm is the channel's own handle for what it accepted (a
 * Slack `ts`). It is stored so a later surface can thread a reply onto the same message
 * rather than starting a new one, and stored via `coalesce` in the repository, so a
 * replay never moves it.
 *
 * Inherited obligation, the same one `summaryFailureCodeSchema` hands to its adapter:
 * `message` is plain English for a human, and the vendor's own error text must never
 * reach it verbatim. A Slack API error can carry channel ids, team ids, and
 * request-identifying detail, and `z.string` accepts all of it silently. The schema
 * cannot enforce this. The adapter must, with a test pinning it.
 */
export const postResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    messageRef: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    code: postFailureCodeSchema,
    message: z.string().min(1),
  }),
]);
export type PostResult = z.infer<typeof postResultSchema>;

/** What the poster needs in order to post one message to one channel. */
export type PostRequest = {
  readonly channelId: string;
  /** The rendered blocks, as `renderSlackMessage` produced them. */
  readonly blocks: readonly unknown[];
  /** The plaintext fallback, what a notification preview and a screen reader read.
   * Never empty: a blocks-only message is silent in both. */
  readonly fallbackText: string;
};

/**
 * The port. One method, because one message to one channel is the whole contract.
 * Batching, threading, and updates are later outcomes' surfaces and would each widen
 * this shape when they arrive.
 *
 * Never throws. Every failure comes back on the `ok: false` arm, because the caller is
 * a worker task whose obligation is that a delivery failure leaves the pipeline's
 * persisted state intact. A port that throws makes that obligation the caller's problem
 * to remember; a port that returns makes it the type system's.
 */
export type DeliveryPoster = {
  post(request: PostRequest): Promise<PostResult>;
};
