import { describe, expect, it } from "bun:test";

import { resolveActiveOrganization, type Membership } from "../../src/index";

describe("resolveActiveOrganization", () => {
  it("returns the session's active organization when it matches a live membership", () => {
    const memberships: Membership[] = [
      {
        organizationId: "org-1",
        organizationName: "Acme",
        role: "owner",
        createdAt: new Date("2024-01-01"),
      },
      {
        organizationId: "org-2",
        organizationName: "Beta",
        role: "member",
        createdAt: new Date("2024-02-01"),
      },
    ];

    expect(resolveActiveOrganization(memberships, "org-2")).toBe("org-2");
  });

  it("falls back to the oldest membership when the session's active org is stale or absent", () => {
    const memberships: Membership[] = [
      {
        organizationId: "org-2",
        organizationName: "Beta",
        role: "member",
        createdAt: new Date("2024-02-01"),
      },
      {
        organizationId: "org-1",
        organizationName: "Acme",
        role: "owner",
        createdAt: new Date("2024-01-01"),
      },
    ];

    // Stale: the session names an organization the user is no longer a member of.
    expect(resolveActiveOrganization(memberships, "org-stale-no-longer-a-member")).toBe("org-1");

    // Absent: the session carries no active-organization hint at all.
    expect(resolveActiveOrganization(memberships, null)).toBe("org-1");

    // Tie: two memberships share the same createdAt. Broken deterministically by
    // organizationId ascending.
    const tied: Membership[] = [
      {
        organizationId: "org-b",
        organizationName: "Bravo",
        role: "member",
        createdAt: new Date("2024-03-01"),
      },
      {
        organizationId: "org-a",
        organizationName: "Alpha",
        role: "member",
        createdAt: new Date("2024-03-01"),
      },
    ];
    expect(resolveActiveOrganization(tied, null)).toBe("org-a");
  });

  it("returns null when the user has no memberships", () => {
    expect(resolveActiveOrganization([], "org-1")).toBeNull();
    expect(resolveActiveOrganization([], null)).toBeNull();
  });
});
