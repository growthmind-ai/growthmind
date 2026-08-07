// D7 for the fix detail route, and the one distinction the route exists to keep: a fix
// another organization owns must answer exactly what an id that never existed answers, and
// a fix we hold and cannot word must NOT answer that — a Slack link to one of those would
// otherwise tell the founder it does not exist. It does; we are holding it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { FIX_SPEC_PAYLOAD_VERSION } from "@growthmind/core";
import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { RENDERABLE_SURFACE } from "../../../../packages/db/__tests__/helpers/fix-spec-payload";
import { readFixDetail } from "../../lib/fixes/read";
import { seedOpenFix } from "./helpers/open-fix";

const NOW = new Date("2026-08-05T00:00:00.000Z");

const NO_SUCH_FIX = "3f2a1b40-0000-4000-8000-000000000000";

// A payload written under a version this build cannot read back: the production shape of
// "we hold this fix and cannot put it into words", reached without deleting anything.
async function makeUnreadable(db: TestDb, findingId: string): Promise<void> {
  await db.$client.query("update finding_payloads set payload_version = $1 where finding_id = $2", [
    FIX_SPEC_PAYLOAD_VERSION + 1,
    findingId,
  ]);
}

describe("the fix detail route", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("a fix another organization owns answers exactly what an id that never existed answers", async () => {
    const mine = await seedOpenFix(db, "cross-mine");
    const theirs = await seedOpenFix(db, "cross-theirs");

    const borrowed = await readFixDetail(db, mine.org.ctx, theirs.fixId, NOW);
    const invented = await readFixDetail(db, mine.org.ctx, NO_SUCH_FIX, NOW);

    expect(borrowed).toEqual({ kind: "missing" });
    expect(borrowed).toEqual(invented);
  });

  test("a fix we hold and cannot word is not a missing one, and keeps its finding to link to", async () => {
    const seeded = await seedOpenFix(db, "held-own");
    await makeUnreadable(db, seeded.findingId);

    expect(await readFixDetail(db, seeded.org.ctx, seeded.fixId, NOW)).toEqual({
      kind: "held",
      findingId: seeded.findingId,
    });
  });

  test("another organization's held fix stays missing, so the hold is never admitted across the boundary", async () => {
    const theirs = await seedOpenFix(db, "held-theirs");
    const mine = await seedOpenFix(db, "held-onlooker");
    await makeUnreadable(db, theirs.findingId);

    expect(await readFixDetail(db, mine.org.ctx, theirs.fixId, NOW)).toEqual({ kind: "missing" });
  });

  test("a readable fix renders the contract, its promised date and what left the denominator", async () => {
    const seeded = await seedOpenFix(db, "contract");

    const view = await readFixDetail(db, seeded.org.ctx, seeded.fixId, NOW);
    if (view.kind !== "contract") throw new Error(`expected a contract, got ${view.kind}`);

    expect(view.findingId).toBe(seeded.findingId);
    expect(view.spec.surface).toBe(RENDERABLE_SURFACE);
    expect(view.spec.symptom.length).toBeGreaterThan(0);
    expect(view.spec.boundary.length).toBeGreaterThan(0);
    expect(view.promise.lead).toContain("We said we would have an answer by");
    expect(view.setAside.some((sentence) => sentence.includes("set aside as"))).toBe(true);
  });
});
