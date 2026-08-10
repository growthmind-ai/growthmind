// RED in Wave 0 against a repository Wave 2 writes. AC-G12 parts 2 and 3: the verdict is the
// write-back, so it is recorded once per change and a lapse closes the row rather than leaving
// it open. See .ai/adds/o-053-report-shipped.md Decision 5c and 5d.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { SHIPPED_UNMEASURED_OUTCOMES, type ShippedReadoutOutcome } from "@growthmind/shared";

import {
  createShippedChangeVerdictsRepo,
  type ShippedChangeVerdictsRepo,
} from "../../src/repositories/shipped-change-verdicts.repo";
import { createShippedChangesRepo } from "../../src/repositories/shipped-changes.repo";
import * as schema from "../../src/schema";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("shipped-verdicts");

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");
const READ_OUT_AT = new Date("2026-08-23T09:05:00.000Z");
const PRESSED_AT = new Date("2026-08-24T11:00:00.000Z");
const PRESSED_AGAIN_AT = new Date("2026-08-24T11:00:30.000Z");
const LAPSED_AT = new Date("2026-08-30T09:05:00.000Z");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function seedReadOutChange(
  label: string,
): Promise<{ org: SeededOrgWithOwner; changeId: string; verdicts: ShippedChangeVerdictsRepo }> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  const change = await createShippedChangesRepo(db, org.ctx).reportShipped({
    projectId: project.id,
    page: "/reports",
    control: "Export CSV",
    description: "CSV export",
    reportedAt: REPORTED_AT,
    readoutDueAt: READOUT_DUE_AT,
  });

  return {
    org,
    changeId: change.change.id,
    verdicts: createShippedChangeVerdictsRepo(db, org.ctx),
  };
}

async function markReadOut(changeId: string): Promise<void> {
  await db
    .update(schema.shippedChanges)
    .set({ state: "read_out", readOutAt: READ_OUT_AT })
    .where(eq(schema.shippedChanges.id, changeId));
}

async function markAbandoned(changeId: string): Promise<void> {
  await db
    .update(schema.shippedChanges)
    .set({ state: "abandoned", abandonedReason: "project_gone", closedAt: LAPSED_AT })
    .where(eq(schema.shippedChanges.id, changeId));
}

// Queried directly for the full change scope: a "most recent verdict" helper would report
// success on a second row that overwrote the founder's answer (.ai/patterns.md #1).
async function verdictRowsFor(organizationId: string, changeId: string) {
  return db
    .select()
    .from(schema.shippedChangeVerdicts)
    .where(
      and(
        eq(schema.shippedChangeVerdicts.organizationId, organizationId),
        eq(schema.shippedChangeVerdicts.changeId, changeId),
      ),
    );
}

async function changeRow(changeId: string) {
  const rows = await db
    .select()
    .from(schema.shippedChanges)
    .where(eq(schema.shippedChanges.id, changeId));

  return rows[0];
}

describe("a verdict is recorded once per change", () => {
  test("a keep press records the verdict and closes the change", async () => {
    const { org, changeId, verdicts } = await seedReadOutChange("keep");
    await markReadOut(changeId);

    const result = await verdicts.recordVerdict({
      changeId,
      verdict: "keep",
      recordedAt: PRESSED_AT,
    });

    expect(result.kind).toBe("recorded");

    const rows = await verdictRowsFor(org.organizationId, changeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("keep");
    expect((await changeRow(changeId))?.state).toBe("closed");
  });

  test("a duplicate press leaves one verdict row and does not overwrite it", async () => {
    const { org, changeId, verdicts } = await seedReadOutChange("duplicate");
    await markReadOut(changeId);

    await verdicts.recordVerdict({ changeId, verdict: "keep", recordedAt: PRESSED_AT });
    const second = await verdicts.recordVerdict({
      changeId,
      verdict: "kill",
      recordedAt: PRESSED_AGAIN_AT,
    });

    expect(second.kind).toBe("already_recorded");

    const rows = await verdictRowsFor(org.organizationId, changeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("keep");
  });

  test("a verdict pressed before the readout is refused and writes nothing", async () => {
    const { org, changeId, verdicts } = await seedReadOutChange("too-early");

    const result = await verdicts.recordVerdict({
      changeId,
      verdict: "keep",
      recordedAt: PRESSED_AT,
    });

    expect(result.kind).toBe("not_read_out");
    expect(await verdictRowsFor(org.organizationId, changeId)).toHaveLength(0);
    expect((await changeRow(changeId))?.state).toBe("reported");
  });

  test("a press on an abandoned change is not answered with the not-yet-read-out refusal", async () => {
    // An abandoned row may well have been read out first, so `not_read_out` would tell the
    // founder something false. Nothing posts buttons on a row that reaches this state, and the
    // caller still needs a true sentence for the press that arrives anyway.
    const { org, changeId, verdicts } = await seedReadOutChange("abandoned-press");
    await markReadOut(changeId);
    await markAbandoned(changeId);

    const result = await verdicts.recordVerdict({
      changeId,
      verdict: "keep",
      recordedAt: PRESSED_AT,
    });

    expect(result.kind).toBe("abandoned");
    expect(await verdictRowsFor(org.organizationId, changeId)).toHaveLength(0);
    expect((await changeRow(changeId))?.state).toBe("abandoned");
  });
});

async function markReadOutWith(changeId: string, readoutOutcome: ShippedReadoutOutcome) {
  await db
    .update(schema.shippedChanges)
    .set({ state: "read_out", readOutAt: READ_OUT_AT, readoutOutcome })
    .where(eq(schema.shippedChanges.id, changeId));
}

describe("a verdict says which readout it answered", () => {
  test("a keep on a change we measured and a keep on one we could not are different rows", async () => {
    const measured = await seedReadOutChange("branch-measured");
    await markReadOutWith(measured.changeId, "measured");
    await measured.verdicts.recordVerdict({
      changeId: measured.changeId,
      verdict: "keep",
      recordedAt: PRESSED_AT,
    });

    const unmeasured = await seedReadOutChange("branch-too-few");
    await markReadOutWith(unmeasured.changeId, "too_few");
    await unmeasured.verdicts.recordVerdict({
      changeId: unmeasured.changeId,
      verdict: "keep",
      recordedAt: PRESSED_AT,
    });

    const onCounts = await verdictRowsFor(measured.org.organizationId, measured.changeId);
    const onNothing = await verdictRowsFor(unmeasured.org.organizationId, unmeasured.changeId);

    expect(onCounts).toHaveLength(1);
    expect(onNothing).toHaveLength(1);

    // Same word, different fact — and DoD item 7 makes these rows what the next brief reads.
    expect(onCounts[0]?.verdict).toBe("keep");
    expect(onNothing[0]?.verdict).toBe("keep");
    expect(onCounts[0]?.readoutOutcome).toBe("measured");
    expect(onNothing[0]?.readoutOutcome).toBe("too_few");
  });

  for (const outcome of SHIPPED_UNMEASURED_OUTCOMES) {
    test(`a lapse on a ${outcome} readout records the branch beside the silence`, async () => {
      const { org, changeId, verdicts } = await seedReadOutChange(`lapse-branch-${outcome}`);
      await markReadOutWith(changeId, outcome);

      await verdicts.recordVerdict({
        changeId,
        verdict: "no_verdict_given",
        recordedAt: LAPSED_AT,
      });

      const rows = await verdictRowsFor(org.organizationId, changeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.verdict).toBe("no_verdict_given");
      expect(rows[0]?.readoutOutcome).toBe(outcome);
    });
  }
});

describe("a lapsed window is itself an answer", () => {
  test("a lapse records no verdict given rather than leaving the row open", async () => {
    const { org, changeId, verdicts } = await seedReadOutChange("lapse");
    await markReadOut(changeId);

    const result = await verdicts.recordVerdict({
      changeId,
      verdict: "no_verdict_given",
      recordedAt: LAPSED_AT,
    });

    expect(result.kind).toBe("recorded");

    const rows = await verdictRowsFor(org.organizationId, changeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("no_verdict_given");

    const change = await changeRow(changeId);
    expect(change?.state).toBe("closed");
    expect(change?.closedAt?.toISOString()).toBe(LAPSED_AT.toISOString());
  });

  test("a verdict pressed after a lapse does not overwrite the recorded absence", async () => {
    const { org, changeId, verdicts } = await seedReadOutChange("lapse-then-press");
    await markReadOut(changeId);

    await verdicts.recordVerdict({
      changeId,
      verdict: "no_verdict_given",
      recordedAt: LAPSED_AT,
    });
    const late = await verdicts.recordVerdict({
      changeId,
      verdict: "keep",
      recordedAt: new Date("2026-09-01T09:00:00.000Z"),
    });

    expect(late.kind).toBe("already_recorded");

    const rows = await verdictRowsFor(org.organizationId, changeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("no_verdict_given");
  });
});
