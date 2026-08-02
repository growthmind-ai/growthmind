import { describe, expect, test } from "bun:test";

import { attributeWriteKey, originForKind } from "../../src/write-keys/attribution";
import type { WriteKeyKind } from "../../src/write-keys/types";

describe("originForKind", () => {
  test('maps kind "standard" to origin "real" and "simulation" to "synthetic"', () => {
    expect(originForKind("standard")).toBe("real");
    expect(originForKind("simulation")).toBe("synthetic");
  });
});

describe("attributeWriteKey", () => {
  test("attribution accepts only the resolved key row — no payload can override origin", () => {
    const resolved: { projectId: string; kind: WriteKeyKind } = {
      projectId: "proj_123",
      kind: "standard",
    };

    const withExtraneousFields: typeof resolved & Record<string, unknown> = {
      ...resolved,
      origin: "synthetic",
      headers: { "x-origin-override": "synthetic" },
      payload: { origin: "synthetic" },
    };

    const result = attributeWriteKey(withExtraneousFields);

    expect(result).toEqual({ projectId: "proj_123", origin: "real" });
  });
});
