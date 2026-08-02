import { describe, expect, test } from "bun:test";

import { getTenantContext } from "@/lib/tenant";

describe("signed-out tenant resolution yields null (drives the row-1 redirect to /sign-in)", () => {
  test("signed-out tenant resolution yields null (drives the row-1 redirect to /sign-in)", async () => {
    const result = await getTenantContext();
    expect(result).toBeNull();
  });
});
