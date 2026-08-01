// / First-Run row 1 (add tasks/tenancy-app-shell/add.md): there is no middleware in
// this app. Every authenticated page calls `getTenantContext` and redirects to
// `ROUTES.signIn` when it resolves `null`. This test pins the single fact that redirect
// depends on: a signed-out caller resolves to `null`, never an error and never a stale
// non-null context.
//
// `getTenantContext` (apps/web/lib/tenant.ts) is a Wave 0 typed stub that throws "not
// implemented", so this test fails here, not on a fixture or compile error, and flips
// green once a later wave implements the real `getAuth.api.getSession` →
// membership → `deriveTenantContext` composition against a genuinely signed-out caller.
import { describe, expect, test } from "bun:test";

import { getTenantContext } from "@/lib/tenant";

describe("signed-out tenant resolution yields null (drives the row-1 redirect to /sign-in)", () => {
  test("signed-out tenant resolution yields null (drives the row-1 redirect to /sign-in)", async () => {
    const result = await getTenantContext();
    expect(result).toBeNull();
  });
});
