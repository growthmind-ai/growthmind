import { describe, it, expect } from "bun:test";
import {
  suppressionReasonCodeSchema,
  ancestryReasonSchema,
  dismissalActionSchema,
  ANCESTRY_RESOLUTION_MAX_HOPS,
} from "../../src/signatures/types";

describe("suppressionReasonCodeSchema", () => {
  it("should expose every suppression reason code the policy can return", () => {
    expect(suppressionReasonCodeSchema.options).toEqual([
      "dismissed",
      "already_delivered",
      "not_seen_before",
      "seen_not_delivered",
      "unresolvable_ancestry",
      "unknown_shape_version",
    ]);
  });
});

describe("ancestryReasonSchema", () => {
  it("should expose an ancestry reason for every known churn class", () => {
    expect(ancestryReasonSchema.options).toEqual([
      "surface_normalisation_version_bump",
      "evidence_shape_version_bump",
      "signature_tuple_version_bump",
      "surface_rename",
      "surface_derivation_swap",
    ]);
  });
});

describe("dismissalActionSchema", () => {
  it("should declare exactly one dismissal action at MVP", () => {
    expect(dismissalActionSchema.options).toEqual(["not_useful"]);
  });
});

describe("ANCESTRY_RESOLUTION_MAX_HOPS", () => {
  it("should be a fixed cap of 8 hops", () => {
    expect(ANCESTRY_RESOLUTION_MAX_HOPS).toBe(8);
  });
});
