import { describe, expect, test } from "bun:test";

import { SUPPRESSION_POLICIES, suppressionDecision } from "../../src/findings/suppression-policy";
import type {
  LedgerRowState,
  ResolvedLedgerState,
  SuppressionDecision,
} from "../../src/findings/suppression-policy";

const DELIVERED_AT = new Date("2026-06-01T12:00:00.000Z");
const DISMISSED_AT = new Date("2026-06-02T09:30:00.000Z");

function resolvedRow(row: LedgerRowState | null): ResolvedLedgerState {
  return { resolution: "resolved", row };
}

describe("suppressionDecision — v1 branch order", () => {
  test("should return suppress with reason dismissed when the row carries dismissed_at", () => {
    const state = resolvedRow({ deliveredAt: null, dismissedAt: DISMISSED_AT });
    expect(suppressionDecision(state, 1)).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  test("should return suppress with reason already_delivered when the row carries delivered_at and no dismissal", () => {
    const state = resolvedRow({ deliveredAt: DELIVERED_AT, dismissedAt: null });
    expect(suppressionDecision(state, 1)).toEqual({
      decision: "suppress",
      reason: "already_delivered",
    });
  });

  test("should prefer dismissed over already_delivered when both are present", () => {
    const state = resolvedRow({ deliveredAt: DELIVERED_AT, dismissedAt: DISMISSED_AT });
    expect(suppressionDecision(state, 1)).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  test("should return deliver with reason seen_not_delivered for a row seen but never delivered", () => {
    const state = resolvedRow({ deliveredAt: null, dismissedAt: null });
    expect(suppressionDecision(state, 1)).toEqual({
      decision: "deliver",
      reason: "seen_not_delivered",
    });
  });

  test("should return deliver with reason not_seen_before when no row exists", () => {
    const state = resolvedRow(null);
    expect(suppressionDecision(state, 1)).toEqual({
      decision: "deliver",
      reason: "not_seen_before",
    });
  });
});

describe("suppressionDecision — both doubt paths assert SUPPRESS ('s inverted fail direction)", () => {
  test("should return suppress with reason unresolvable_ancestry on the doubt path", () => {
    const state: ResolvedLedgerState = { resolution: "unresolvable_ancestry" };
    expect(suppressionDecision(state, 1)).toEqual({
      decision: "suppress",
      reason: "unresolvable_ancestry",
    });
  });

  test("should return suppress with reason unknown_shape_version on the doubt path", () => {
    const state: ResolvedLedgerState = { resolution: "unknown_shape_version" };
    expect(suppressionDecision(state, 1)).toEqual({
      decision: "suppress",
      reason: "unknown_shape_version",
    });
  });
});

describe("suppressionDecision — the policy VERSION's own, distinct fail direction", () => {
  test("should throw for an unregistered policy version rather than falling back to current", () => {
    expect(SUPPRESSION_POLICIES.get(99)).toBeUndefined();
    expect(() => suppressionDecision(resolvedRow(null), 99)).toThrow(/version/i);
  });
});

describe("suppressionDecision — SUPPRESSION_POLICIES.get(1) is a standing guarantee (FR-E f)", () => {
  test("SUPPRESSION_POLICIES.get(1) reproduces v1 decisions for every state", () => {
    const policyV1 = SUPPRESSION_POLICIES.get(1);
    expect(policyV1).toBeDefined();

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly state: ResolvedLedgerState;
      readonly expected: SuppressionDecision;
    }> = [
      {
        name: "unresolvable ancestry",
        state: { resolution: "unresolvable_ancestry" },
        expected: { decision: "suppress", reason: "unresolvable_ancestry" },
      },
      {
        name: "unknown shape version",
        state: { resolution: "unknown_shape_version" },
        expected: { decision: "suppress", reason: "unknown_shape_version" },
      },
      {
        name: "dismissed and delivered",
        state: resolvedRow({ deliveredAt: DELIVERED_AT, dismissedAt: DISMISSED_AT }),
        expected: { decision: "suppress", reason: "dismissed" },
      },
      {
        name: "delivered only",
        state: resolvedRow({ deliveredAt: DELIVERED_AT, dismissedAt: null }),
        expected: { decision: "suppress", reason: "already_delivered" },
      },
      {
        name: "seen, never delivered",
        state: resolvedRow({ deliveredAt: null, dismissedAt: null }),
        expected: { decision: "deliver", reason: "seen_not_delivered" },
      },
      {
        name: "no row",
        state: resolvedRow(null),
        expected: { decision: "deliver", reason: "not_seen_before" },
      },
    ];

    expect(cases.length).toBe(6);

    for (const { state, expected } of cases) {
      expect(policyV1!(state)).toEqual(expected);

      expect(suppressionDecision(state, 1)).toEqual(expected);
    }
  });
});

describe("suppressionDecision — purity (no clock, no I/O)", () => {
  test("should read no clock and perform no I/O", () => {
    const state = resolvedRow({ deliveredAt: DELIVERED_AT, dismissedAt: null });

    const first = suppressionDecision(state, 1);
    const second = suppressionDecision(state, 1);

    expect(first).toEqual(second);
    expect(first).toEqual({ decision: "suppress", reason: "already_delivered" });
  });
});
