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

    // /: the guarantee is the function's *type*. There is no parameter through which an
    // origin could be forced. Simulate a caller that has extraneous fields sitting on
    // the object it hands in (e.g. a spoofed `origin`, a request header, a raw payload)
    // and assert none of it can influence the returned origin, which must be derived
    // from `kind` alone.
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
