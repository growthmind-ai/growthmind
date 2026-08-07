// O-051 job 2 (ADD D-6, ruling 2): a mute exists only when something is off, it belongs
// to one viewer, and act_now is unrepresentable — in the parameter type AND at the
// database, so no code path and no raw write can hide a health notification. RED in
// Wave 0 against the throwing repo stubs and the missing database constraint.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import type { MutableNotificationClass } from "@growthmind/shared";

import { createNotificationMutesRepo } from "../../src/repositories/notification-mutes.repo";
import {
  createTestDb,
  laneNames,
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedUser,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";
import { captureRejection } from "../helpers/onboarding-contract";

const NAMES = laneNames("notification-mutes");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
  return seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
}

describe("the schema rejects a mute for act_now", () => {
  test("the repo's parameter type has no act_now member, and the database refuses the raw row", async () => {
    // @ts-expect-error — act_now is structurally unrepresentable in a mute (ruling 2); if
    // this line ever compiles, the closed union has been widened and the guarantee is gone.
    const forbidden: MutableNotificationClass = "act_now";
    void forbidden;

    // The parameter type is the first belt; the database is the second, because a raw
    // write bypasses every TypeScript union (AC-20).
    const org = await seedOrg("reject-act-now");
    await captureRejection(() =>
      db.execute(sql`
        insert into notification_mutes (organization_id, user_id, class)
        values (${org.organizationId}, ${org.userId}, 'act_now')
      `),
    );

    const stored = await db.execute(sql`
      select class from notification_mutes where organization_id = ${org.organizationId}
    `);
    expect((stored as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
});

describe("a mute exists only when something is off, for one viewer", () => {
  test("mute and unmute round-trip per viewer, and a second mute of the same class is one row", async () => {
    const org = await seedOrg("round-trip");
    const repo = createNotificationMutesRepo(db, org.ctx);

    expect(await repo.listMutedClasses()).toEqual([]);

    await repo.mute("work");
    await repo.mute("work");
    expect(await repo.listMutedClasses()).toEqual(["work"]);

    const stored = await db.execute(sql`
      select class from notification_mutes
      where organization_id = ${org.organizationId} and user_id = ${org.userId}
    `);
    expect((stored as unknown as { rows: unknown[] }).rows).toHaveLength(1);

    await repo.unmute("work");
    expect(await repo.listMutedClasses()).toEqual([]);

    // Unmuting what was never muted is a no-op, not an error: the card's checkbox can be
    // pressed in any order.
    await repo.unmute("record");
    expect(await repo.listMutedClasses()).toEqual([]);
  });

  test("one member's mute never reaches a teammate's bell", async () => {
    const org = await seedOrg("per-viewer");
    const mate = await seedUser(db, {
      name: NAMES.userName("per-viewer-mate"),
      email: NAMES.email("per-viewer-mate"),
    });
    await seedMember(db, { organizationId: org.organizationId, userId: mate.id, role: "member" });
    const mateCtx = makeTenantContext({
      userId: mate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    await createNotificationMutesRepo(db, org.ctx).mute("record");

    expect(await createNotificationMutesRepo(db, org.ctx).listMutedClasses()).toEqual(["record"]);
    expect(await createNotificationMutesRepo(db, mateCtx).listMutedClasses()).toEqual([]);
  });
});
