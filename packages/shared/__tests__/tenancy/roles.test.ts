import { describe, expect, it } from "bun:test";

import {
  isMachinePrincipal,
  mayAdminister,
  memberUserId,
  parseMemberRoles,
  type TenantContext,
} from "../../src/index";

function contextWithRole(role: string, userId = "user-1"): TenantContext {
  return { userId, organizationId: "org-1", organizationName: "Acme", role };
}

describe("parseMemberRoles", () => {
  it("reads a single role", () => {
    expect(parseMemberRoles("owner")).toEqual(["owner"]);
    expect(parseMemberRoles("member")).toEqual(["member"]);
  });

  it("reads several roles comma-joined, which exact equality misses", () => {
    expect(parseMemberRoles("owner,admin")).toEqual(["owner", "admin"]);
  });

  it("tolerates the whitespace and casing the column may hold", () => {
    expect(parseMemberRoles(" Owner , ADMIN ")).toEqual(["owner", "admin"]);
  });

  it("drops a name it does not define rather than coercing it", () => {
    expect(parseMemberRoles("superuser")).toEqual([]);
    expect(parseMemberRoles("owner,superuser")).toEqual(["owner"]);
  });

  it("returns nothing for an empty column", () => {
    expect(parseMemberRoles("")).toEqual([]);
    expect(parseMemberRoles("   ")).toEqual([]);
  });

  it("does not repeat a role listed twice", () => {
    expect(parseMemberRoles("admin,admin")).toEqual(["admin"]);
  });
});

describe("mayAdminister", () => {
  it("admits an owner and an admin", () => {
    expect(mayAdminister(contextWithRole("owner"))).toBe(true);
    expect(mayAdminister(contextWithRole("admin"))).toBe(true);
  });

  it("refuses a plain member — every org-wide write hangs off this", () => {
    expect(mayAdminister(contextWithRole("member"))).toBe(false);
  });

  it("admits a comma-joined set containing owner, the case exact equality denied", () => {
    expect(mayAdminister(contextWithRole("owner,admin"))).toBe(true);
    expect(mayAdminister(contextWithRole("member,admin"))).toBe(true);
  });

  it("fails closed on a role it cannot read", () => {
    expect(mayAdminister(contextWithRole("superuser"))).toBe(false);
    expect(mayAdminister(contextWithRole(""))).toBe(false);
  });

  it("refuses both machine principals, which administer nothing", () => {
    expect(mayAdminister(contextWithRole("api_key"))).toBe(false);
    expect(mayAdminister(contextWithRole("system"))).toBe(false);
  });
});

describe("isMachinePrincipal", () => {
  it("names the two non-human principals and nothing else", () => {
    expect(isMachinePrincipal(contextWithRole("api_key"))).toBe(true);
    expect(isMachinePrincipal(contextWithRole("system"))).toBe(true);

    for (const role of ["owner", "admin", "member", "superuser", ""]) {
      expect(`${role}: ${isMachinePrincipal(contextWithRole(role))}`).toBe(`${role}: false`);
    }
  });
});

describe("memberUserId", () => {
  it("returns a person's user id", () => {
    expect(memberUserId(contextWithRole("owner", "user-7"))).toBe("user-7");
    expect(memberUserId(contextWithRole("member", "user-7"))).toBe("user-7");
  });

  it("returns null for an api key, whose userId is not a row in `user`", () => {
    expect(memberUserId(contextWithRole("api_key", "api-key:abc123"))).toBeNull();
  });

  it("returns null for a scheduled task", () => {
    expect(memberUserId(contextWithRole("system", "system:delivery-tick"))).toBeNull();
  });

  // The two predicates fail in opposite directions on purpose: an unreadable role must not
  // grant a capability, and must not cost a real person their attribution either.
  it("still attributes a person whose role it cannot read", () => {
    expect(memberUserId(contextWithRole("superuser", "user-9"))).toBe("user-9");
    expect(mayAdminister(contextWithRole("superuser", "user-9"))).toBe(false);
  });
});
