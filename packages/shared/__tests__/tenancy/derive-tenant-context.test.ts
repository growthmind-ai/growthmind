import { describe, expect, it } from "bun:test";

import {
  deriveTenantContext,
  tenantContextSchema,
  tenantResolutionInputSchema,
} from "../../src/index";

describe("deriveTenantContext", () => {
  it("derives a full tenant context from session plus memberships", () => {
    const input = {
      session: { userId: "user-1", activeOrganizationId: "org-1" },
      memberships: [
        {
          organizationId: "org-1",
          organizationName: "Acme",
          role: "owner",
          createdAt: new Date("2024-01-01"),
        },
      ],
    };

    const context = deriveTenantContext(input);

    expect(context).not.toBeNull();

    const parsed = tenantContextSchema.safeParse(context);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        userId: "user-1",
        organizationId: "org-1",
        organizationName: "Acme",
        role: "owner",
      });
    }
  });

  it("resolution input schema has no field that could carry a client-supplied organization id", () => {
    // An attacker-controlled request body naming an org override at the top
    // level — the exact shape FR-3/D7 says must be structurally impossible.
    const maliciousInput = {
      session: { userId: "user-1", activeOrganizationId: "org-1" },
      memberships: [
        {
          organizationId: "org-1",
          organizationName: "Acme",
          role: "owner",
          createdAt: new Date("2024-01-01"),
        },
      ],
      organizationId: "attacker-org",
      activeOrganizationId: "attacker-org",
    };

    const parsed = tenantResolutionInputSchema.parse(maliciousInput);

    // The injected top-level fields must be stripped by the schema — Zod's
    // default object behaviour, no `.passthrough()` anywhere in the chain.
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("activeOrganizationId");
    expect(Object.keys(parsed).toSorted()).toEqual(["memberships", "session"]);

    // Even fed the parsed (stripped) input, the resolved context must name
    // the real membership's org — never the injected value.
    const context = deriveTenantContext(parsed);
    expect(context?.organizationId).toBe("org-1");
    expect(context?.organizationId).not.toBe("attacker-org");
  });
});
