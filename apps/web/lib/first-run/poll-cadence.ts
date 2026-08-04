import type { AgentConnection, FirstRunDeliveryState } from "@growthmind/shared";

export const ARMED_POLL_MS = 1_000;

export const PRE_ARM_POLL_MS = 10_000;

// Nothing on a terminal stage ticks; the delivery lane it waits on runs quarter-hourly.
export const DELIVERY_WATCH_POLL_MS = 10_000;

export interface AgentWatchInput {
  readonly connection: AgentConnection;

  readonly heldKey: string | null;
}

// A key minted in this tab is in flight before any payload says so: the render
// that carried the connection was served before the press that made the key.
export function agentStillWatched(input: AgentWatchInput): boolean {
  if (input.connection.kind === "connected") {
    return false;
  }

  return input.connection.kind === "waiting" || input.heldKey !== null;
}

export interface PollCadenceInput {
  readonly attached: boolean;
  readonly armed: boolean;

  readonly terminal: boolean;

  readonly deliveryState: FirstRunDeliveryState;

  readonly agentWaiting: boolean;
}

// `null` means nothing left to watch, and nothing else.
export function resolvePollCadenceMs(input: PollCadenceInput): number | null {
  const watching = resolveWatchedCadenceMs(input);

  // First contact arrives from outside the browser, so a key that has never been
  // used is only ever noticed by asking again.
  if (watching === null && input.agentWaiting) {
    return PRE_ARM_POLL_MS;
  }

  return watching;
}

function resolveWatchedCadenceMs(input: PollCadenceInput): number | null {
  // The hourly check produces findings for projects nobody armed; that founder is in setup.
  if (!input.armed) {
    return input.attached ? PRE_ARM_POLL_MS : null;
  }

  if (!input.terminal) {
    return ARMED_POLL_MS;
  }

  return input.deliveryState === "unposted" ? DELIVERY_WATCH_POLL_MS : null;
}
