// One definition of "not an address", for every consumer of a stored channel id.
//
// There were two, in two packages, holding the same three strings independently —
// and nothing failed if they drifted. A sentinel added to one and not the other
// produces `deliveryState: "posted"` beside a render that returns null, or `#null`
// back on screen. They could not simply be merged because `@growthmind/db`'s barrel
// pulls `pg` and drizzle and cannot enter a client bundle; this module has no
// dependencies at all, so both sides can consume it.
//
// A third home is the `attachChannel` fill guard, which is SQL and cannot call a
// predicate — it consumes the list below instead.

// What a stringified null looks like once it has already gone wrong. Lowercased
// and trimmed before the comparison, so `" NULL "` is caught too.
export const NON_ADDRESS_SENTINELS: readonly string[] = Object.freeze(["null", "undefined"]);

// Every value the SQL guard must treat as "no address chosen yet", including the
// empty string that `NON_ADDRESS_SENTINELS` leaves to the length check here.
export const NON_ADDRESS_VALUES: readonly string[] = Object.freeze(["", ...NON_ADDRESS_SENTINELS]);

export function isDeliveryAddress(channelId: string | null | undefined): boolean {
  if (typeof channelId !== "string") {
    return false;
  }

  const trimmed = channelId.trim().toLowerCase();

  return trimmed.length > 0 && !NON_ADDRESS_SENTINELS.includes(trimmed);
}
