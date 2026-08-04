import { describe, expect, test } from "bun:test";

import type { ConnectionStateStatus } from "../../src/session-source/types";
import { landingAttention } from "../../src/onboarding/attention";
import {
  ATTENTION_NO_DELIVERY_HEADLINE,
  ATTENTION_SOURCE_ACTION,
  ATTENTION_SOURCE_FAILING_HEADLINE,
  ATTENTION_SOURCE_STOPPED_HEADLINE,
  LANDING_LIVENESS_DISCONNECTED,
  LANDING_LIVENESS_FAILING,
  LANDING_LIVENESS_NOT_CONNECTED,
} from "../../src/onboarding/messages";

const HEALTHY: readonly ConnectionStateStatus[] = [
  "validating",
  "connected_never_polled",
  "connected_no_events_yet",
  "connected_receiving",
];

describe("landingAttention", () => {
  test("a working source delivering somewhere needs nobody", () => {
    for (const sourceStatus of HEALTHY) {
      expect(landingAttention({ sourceStatus, hasDeliveryTarget: true })).toBeNull();
    }
  });

  test("each broken source names itself with the sentence that describes it", () => {
    expect(landingAttention({ sourceStatus: "failing", hasDeliveryTarget: true })).toEqual({
      reason: "source_failing",
      headline: ATTENTION_SOURCE_FAILING_HEADLINE,
      detail: LANDING_LIVENESS_FAILING,
      action: ATTENTION_SOURCE_ACTION,
    });

    expect(landingAttention({ sourceStatus: "disconnected", hasDeliveryTarget: true })).toEqual({
      reason: "source_disconnected",
      headline: ATTENTION_SOURCE_STOPPED_HEADLINE,
      detail: LANDING_LIVENESS_DISCONNECTED,
      action: ATTENTION_SOURCE_ACTION,
    });

    expect(landingAttention({ sourceStatus: "not_connected", hasDeliveryTarget: true })).toEqual({
      reason: "source_not_connected",
      headline: ATTENTION_SOURCE_STOPPED_HEADLINE,
      detail: LANDING_LIVENESS_NOT_CONNECTED,
      action: ATTENTION_SOURCE_ACTION,
    });
  });

  test("a healthy source with nowhere to deliver names the channel", () => {
    for (const sourceStatus of HEALTHY) {
      expect(landingAttention({ sourceStatus, hasDeliveryTarget: false })?.reason).toBe(
        "no_delivery_target",
      );
      expect(landingAttention({ sourceStatus, hasDeliveryTarget: false })?.headline).toBe(
        ATTENTION_NO_DELIVERY_HEADLINE,
      );
    }
  });

  test("a broken source outranks a missing channel, because it is upstream of it", () => {
    // Both are wrong at once for a founder who skipped Slack and whose key then expired.
    // Naming the channel first sends them to fix the half that changes nothing until the
    // source is reading again.
    expect(landingAttention({ sourceStatus: "failing", hasDeliveryTarget: false })?.reason).toBe(
      "source_failing",
    );
  });

  test("an unreadable side claims no fault about that side", () => {
    // A query that failed is not evidence that a founder's analytics is down, and saying so
    // is the honesty rule broken in the direction that costs trust fastest.
    expect(landingAttention({ sourceStatus: null, hasDeliveryTarget: true })).toBeNull();
    expect(landingAttention({ sourceStatus: null, hasDeliveryTarget: null })).toBeNull();

    for (const sourceStatus of HEALTHY) {
      expect(landingAttention({ sourceStatus, hasDeliveryTarget: null })).toBeNull();
    }
  });

  test("an unreadable delivery side still reports a source fault it did read", () => {
    expect(landingAttention({ sourceStatus: "failing", hasDeliveryTarget: null })?.reason).toBe(
      "source_failing",
    );
  });

  test("every fault names what to do, not only what is wrong", () => {
    // The activation rule: a terminal state with no named next action is a dead end. This
    // block sits above one button whose label is a destination, so without the action line
    // the reader has to infer that going there is also the fix.
    const faults = [
      { sourceStatus: "failing" as const, hasDeliveryTarget: true },
      { sourceStatus: "disconnected" as const, hasDeliveryTarget: true },
      { sourceStatus: "not_connected" as const, hasDeliveryTarget: true },
      { sourceStatus: "connected_receiving" as const, hasDeliveryTarget: false },
    ];

    for (const fault of faults) {
      const action = landingAttention(fault)?.action ?? "";

      expect(action.trim().length).toBeGreaterThan(0);
      expect(action).toMatch(/\b(reconnect|connect)\b/i);
    }
  });

  test("every reason carries both a headline and a detail, and they are not the same words", () => {
    const inputs = [
      { sourceStatus: "failing" as const, hasDeliveryTarget: true },
      { sourceStatus: "disconnected" as const, hasDeliveryTarget: true },
      { sourceStatus: "not_connected" as const, hasDeliveryTarget: true },
      { sourceStatus: "connected_receiving" as const, hasDeliveryTarget: false },
    ];

    for (const input of inputs) {
      const attention = landingAttention(input);

      expect(attention).not.toBeNull();
      expect(attention?.headline.trim().length).toBeGreaterThan(0);
      expect(attention?.detail.trim().length).toBeGreaterThan(0);
      expect(attention?.headline).not.toBe(attention?.detail);
    }
  });
});
