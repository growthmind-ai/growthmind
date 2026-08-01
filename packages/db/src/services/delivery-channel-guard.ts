// The one narrowing from "a workspace is attached" to "there is somewhere to
// post" (O-008, AD-4).
//
// `slack_connections.channel_id` is nullable since migration 0010, because the
// OAuth callback stores a real bot token before anybody has chosen a channel. A
// row with a null channel therefore means two things at once — the workspace is
// attached, and nothing can be delivered — and every reader in the delivery
// path has to answer the second one. A reader that still believes the column is
// `string` does not crash: it interpolates, and the address that reaches Slack
// is the four characters `null`.
//
// Why this is one predicate rather than a null check at each call site. A null
// check is a thing somebody remembers, and the next reader added to the
// delivery path is the one who does not. There are three reads today (the
// lane's address, the delivery ledger's dedup key, the first-run test post) and
// they sit in three packages; one guard means the answer is written once and
// the compiler carries it to all of them.
//
// Why it takes the CONNECTION and not the channel string. The same reasoning
// `slackCredentialAad` states for taking a `TenantContext` rather than an
// organization id (`../schema/slack-connections.ts`): a `string | null`
// parameter accepts any string in scope, and the value handed to it by mistake
// is exactly the one that was never the channel.
//
// Why it is a TYPE PREDICATE. The narrowing survives into the caller, so a
// guarded call site reads the channel as a plain `string` and NO CALL SITE
// NEEDS A `!`. A non-null assertion is what would re-open this hole one
// refactor later — it compiles just as happily on the day the guard is deleted.
//
// This module holds no database handle and performs no I/O. It lives in
// `packages/db` because the two types it narrows are this package's
// (`SlackConnectionSummary`, `SlackDeliveryOrganization`), and a guard in a
// package neither the web app nor the worker already depends on would be a
// dependency added for a predicate.

/**
 * Anything carrying a Slack connection's stored channel.
 *
 * Structural on purpose: `SlackConnectionSummary` (the repository's DTO) and
 * `SlackDeliveryOrganization` (the delivery population's row) are different
 * shapes that answer the same question, and a guard that named either one would
 * push the second caller into a cast.
 */
export interface ChannelBearingConnection {
  readonly channelId: string | null;
}

/**
 * A connection proven to carry a postable address.
 *
 * The intersection rather than a rewritten interface, so the caller keeps every
 * other field it had — the lane still reads `organizationName`, the test post
 * still reads `connectedByUserId` — and only the channel changes type.
 */
export type DeliveryTarget<T extends ChannelBearingConnection> = T & {
  readonly channelId: string;
};

/**
 * What a stringified null looks like once it has already gone wrong.
 *
 * These are not defensive spelling variants of `null`; they are the values a
 * `text` column and a template literal actually produce when a null has passed
 * through a boundary that coerced instead of refusing. By the time one of these
 * is in the column the mistake is upstream, and the only useful thing this
 * guard can do is decline to post to it. Compared case-insensitively and after
 * trimming, because none of those transports preserves case or spacing
 * reliably.
 */
const NOT_AN_ADDRESS: ReadonlySet<string> = new Set(["null", "undefined"]);

/**
 * Whether this connection can be delivered to.
 *
 * `false` is an ORDINARY ANSWER, not a fault: a workspace attached and no
 * channel chosen is the state AD-4 exists to make writable, and the founder in
 * that window is mid-setup rather than broken. Callers refuse; they do not
 * throw and they do not log an error.
 *
 * It does NOT normalise. A predicate that trimmed would tell one caller the
 * value is fine while a second caller posted the untrimmed original — two
 * answers to one question, which is the shape this guard exists to remove.
 * Refusing a blank channel here is a floor under the delivery path and never a
 * substitute for validating the channel at the point it is written.
 */
export function isDeliveryTarget<T extends ChannelBearingConnection>(
  connection: T,
): connection is DeliveryTarget<T> {
  const { channelId } = connection;

  if (channelId === null) {
    return false;
  }

  // Whitespace-only is refused for the same reason the empty string is: a
  // channel named nothing and no channel at all must never be the same value,
  // which is precisely the collapse a sentinel would create.
  const trimmed = channelId.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return !NOT_AN_ADDRESS.has(trimmed.toLowerCase());
}
