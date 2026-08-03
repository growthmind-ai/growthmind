import { isDeliveryAddress } from "@growthmind/shared";

export interface ChannelBearingConnection {
  readonly channelId: string | null;
}

export type DeliveryTarget<T extends ChannelBearingConnection> = T & {
  readonly channelId: string;
};

// A TYPE PREDICATE, and it takes the CONNECTION rather than a bare channel string: the
// narrowing survives into the caller, so NO CALL SITE NEEDS A `!`. What counts as an
// address is `@growthmind/shared`'s to say — this package's barrel cannot enter a client
// bundle, and the screens need the same answer.
export function isDeliveryTarget<T extends ChannelBearingConnection>(
  connection: T,
): connection is DeliveryTarget<T> {
  return isDeliveryAddress(connection.channelId);
}
