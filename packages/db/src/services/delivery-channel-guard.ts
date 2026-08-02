export interface ChannelBearingConnection {
  readonly channelId: string | null;
}

export type DeliveryTarget<T extends ChannelBearingConnection> = T & {
  readonly channelId: string;
};

// Refuses "null", "undefined", "" and whitespace: those are what a stringified null looks
// like once it has already gone wrong, never an address. Trimmed, case-insensitive.
const NOT_AN_ADDRESS: ReadonlySet<string> = new Set(["null", "undefined"]);

// A TYPE PREDICATE, and it takes the CONNECTION rather than a bare channel string: the
// narrowing survives into the caller, so NO CALL SITE NEEDS A `!`.
export function isDeliveryTarget<T extends ChannelBearingConnection>(
  connection: T,
): connection is DeliveryTarget<T> {
  const { channelId } = connection;

  if (channelId === null) {
    return false;
  }

  const trimmed = channelId.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return !NOT_AN_ADDRESS.has(trimmed.toLowerCase());
}
