import type { ConnectionStateStatus } from "../session-source/types";
import {
  ATTENTION_NO_DELIVERY_ACTION,
  ATTENTION_NO_DELIVERY_DETAIL,
  ATTENTION_NO_DELIVERY_HEADLINE,
  ATTENTION_SOURCE_ACTION,
  ATTENTION_SOURCE_FAILING_HEADLINE,
  ATTENTION_SOURCE_STOPPED_HEADLINE,
  LANDING_LIVENESS_DISCONNECTED,
  LANDING_LIVENESS_FAILING,
  LANDING_LIVENESS_NOT_CONNECTED,
} from "./messages";

export type LandingAttentionReason =
  | "source_failing"
  | "source_disconnected"
  | "source_not_connected"
  | "no_delivery_target";

export interface LandingAttention {
  readonly reason: LandingAttentionReason;
  readonly headline: string;
  readonly detail: string;

  // What to do, named. The control that does it is the one door under this block; without
  // this line the reader has to infer that a destination label is also a fix.
  readonly action: string;
}

const SENTENCES: Record<LandingAttentionReason, Omit<LandingAttention, "reason">> = {
  source_failing: {
    headline: ATTENTION_SOURCE_FAILING_HEADLINE,
    detail: LANDING_LIVENESS_FAILING,
    action: ATTENTION_SOURCE_ACTION,
  },
  source_disconnected: {
    headline: ATTENTION_SOURCE_STOPPED_HEADLINE,
    detail: LANDING_LIVENESS_DISCONNECTED,
    action: ATTENTION_SOURCE_ACTION,
  },
  source_not_connected: {
    headline: ATTENTION_SOURCE_STOPPED_HEADLINE,
    detail: LANDING_LIVENESS_NOT_CONNECTED,
    action: ATTENTION_SOURCE_ACTION,
  },
  no_delivery_target: {
    headline: ATTENTION_NO_DELIVERY_HEADLINE,
    detail: ATTENTION_NO_DELIVERY_DETAIL,
    action: ATTENTION_NO_DELIVERY_ACTION,
  },
};

// Total over the status union, so an eighth connection state is a compile error here rather
// than a fault that silently reads as healthy on the one screen that reports health.
function sourceReason(status: ConnectionStateStatus): LandingAttentionReason | null {
  switch (status) {
    case "failing":
      return "source_failing";
    case "disconnected":
      return "source_disconnected";
    case "not_connected":
      return "source_not_connected";
    case "validating":
    case "connected_never_polled":
    case "connected_no_events_yet":
    case "connected_receiving":
      return null;
  }
}

export interface LandingAttentionInput {
  // `null` on both fields is "could not be read", which is not evidence of a fault. Naming
  // one anyway would break the honesty rule in the loud direction — telling a founder their
  // analytics is down because a query failed — so an unreadable side yields no block.
  readonly sourceStatus: ConnectionStateStatus | null;
  readonly hasDeliveryTarget: boolean | null;
}

// Source before delivery: with nothing to read there is nothing to deliver, so naming the
// channel first sends a founder to fix the half that is not the problem.
export function landingAttention(input: LandingAttentionInput): LandingAttention | null {
  const source = input.sourceStatus === null ? null : sourceReason(input.sourceStatus);
  if (source !== null) {
    return { reason: source, ...SENTENCES[source] };
  }

  if (input.hasDeliveryTarget === false) {
    return { reason: "no_delivery_target", ...SENTENCES.no_delivery_target };
  }

  return null;
}
