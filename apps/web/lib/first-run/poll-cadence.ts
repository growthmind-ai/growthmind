import type { FirstRunDeliveryState } from "@growthmind/shared";

export const ARMED_POLL_MS = 1_000;

export const PRE_ARM_POLL_MS = 10_000;

// Nothing on a terminal stage ticks; the delivery lane it waits on runs quarter-hourly.
export const DELIVERY_WATCH_POLL_MS = 10_000;

export interface PollCadenceInput {
  readonly attached: boolean;
  readonly armed: boolean;

  readonly terminal: boolean;

  readonly deliveryState: FirstRunDeliveryState;
}

// `null` means nothing left to watch, and nothing else.
export function resolvePollCadenceMs(input: PollCadenceInput): number | null {
  // The hourly check produces findings for projects nobody armed; that founder is in setup.
  if (!input.armed) {
    return input.attached ? PRE_ARM_POLL_MS : null;
  }

  if (!input.terminal) {
    return ARMED_POLL_MS;
  }

  return input.deliveryState === "unposted" ? DELIVERY_WATCH_POLL_MS : null;
}
