// FR-9/D3 (ADD tasks/tenancy-app-shell/add.md, decision D-E): the teammate
// fixture is built through Better Auth's real server-side organization API
// (`auth.api.addMember`, wrapped verbatim by the shared fixture's
// `addTestMember`) — never a raw `member`-row seed — and adding the same
// member twice must yield exactly one membership row (D3 idempotency).
//
// Both tests wire `onUserCreate` to the REAL (still-unimplemented)
// `ensureOrganization` (apps/web/lib/ensure-organization.ts, D-C) to create
// the owner's organization, rather than the fixture's `createTestOrganization`
// bypass — so the "existing organization" a teammate is added to is the same
// one the real signup path produces, matching FR-9's own words ("the real
// product path"). At Wave 0, `ensureOrganization` throws "not implemented",
// so both tests fail during owner signup — not on a fixture or compile
// error — and both flip green once it is implemented, with no change to
// this file.
import { randomUUID } from "node:crypto";

import { createTestDb, type TestDbHandle } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ensureOrganization } from "@/lib/ensure-organization";

import { addTestMember, createTestAuth, readMembershipsForUser, signUpTestUser } from "./helpers/auth-fixture";

const PASSWORD = "correct-horse-battery";

describe("a second user added through Better Auth machinery becomes a member of the existing organization", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("a second user added through Better Auth machinery becomes a member of the existing organization", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const ownerEmail = `member-add-owner-${randomUUID()}@example.com`;
    const owner = await signUpTestUser(auth, { name: "Owner User", email: ownerEmail, password: PASSWORD });

    const ownerMemberships = await readMembershipsForUser(handle.db, owner.id);
    expect(ownerMemberships).toHaveLength(1);
    const organizationId = ownerMemberships[0]!.organizationId;

    const teammateEmail = `member-add-teammate-${randomUUID()}@example.com`;
    const teammate = await signUpTestUser(auth, { name: "Teammate User", email: teammateEmail, password: PASSWORD });

    // The real product path (D-E) — never a raw `member`-row insert.
    const addedMember = await addTestMember(auth, {
      organizationId,
      userId: teammate.id,
      role: "member",
    });
    expect(addedMember?.organizationId).toBe(organizationId);
    expect(addedMember?.userId).toBe(teammate.id);

    const teammateMemberships = await readMembershipsForUser(handle.db, teammate.id);
    expect(
      teammateMemberships.some((row) => row.organizationId === organizationId && row.role === "member"),
    ).toBe(true);
  });
});

describe("adding the same member twice yields exactly one membership", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("adding the same member twice yields exactly one membership", async () => {
    const auth = createTestAuth(handle.db, {
      onUserCreate: async (user) => {
        await ensureOrganization(handle.db, user);
      },
    });

    const ownerEmail = `member-dup-owner-${randomUUID()}@example.com`;
    const owner = await signUpTestUser(auth, { name: "Owner User", email: ownerEmail, password: PASSWORD });

    const ownerMemberships = await readMembershipsForUser(handle.db, owner.id);
    expect(ownerMemberships).toHaveLength(1);
    const organizationId = ownerMemberships[0]!.organizationId;

    const teammateEmail = `member-dup-teammate-${randomUUID()}@example.com`;
    const teammate = await signUpTestUser(auth, { name: "Teammate User", email: teammateEmail, password: PASSWORD });

    await addTestMember(auth, { organizationId, userId: teammate.id, role: "member" });

    // Better Auth itself enforces D3 by THROWING on a duplicate add
    // (`USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`, pinned by
    // auth-hooks.spike.test.ts) rather than silently no-opping. D-E's own
    // text names the fallback: "if Better Auth does not enforce this
    // itself, ensure-style idempotency wraps the call at our service edge" —
    // it does enforce it, via a throw, so the future service edge must catch
    // exactly this error and re-read the existing membership rather than
    // propagate it. This test pins the END-STATE contract (exactly one
    // membership survives two attempts); it deliberately catches the
    // duplicate throw itself rather than asserting on whether the call
    // throws, since that mechanics is Better Auth's own proven behavior, not
    // ours to re-decide.
    let duplicateError: unknown;
    try {
      await addTestMember(auth, { organizationId, userId: teammate.id, role: "member" });
    } catch (error) {
      duplicateError = error;
    }
    // Better Auth surfaces the machine-readable reason on `error.body.code`;
    // its `message`/`toString()` carry only the prose form ("User is already
    // a member of this organization"), so assert the code where it actually
    // lives rather than on the rendered string.
    expect((duplicateError as { body?: { code?: string } })?.body?.code).toContain(
      "ALREADY_A_MEMBER",
    );

    const teammateMemberships = await readMembershipsForUser(handle.db, teammate.id);
    const matchingOrgMemberships = teammateMemberships.filter((row) => row.organizationId === organizationId);
    expect(matchingOrgMemberships).toHaveLength(1);
  });
});
