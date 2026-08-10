// RED in Wave 0 against a repository Wave 2 writes. The change key is (org, project, page,
// control label) and the label is optional, so a nullable label would let every page-level
// re-report start a second clock: see .ai/adds/o-053-report-shipped.md Decision 3a.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import {
  NO_CONTROL_LABEL,
  SHIPPED_UNMEASURED_OUTCOMES,
  URL_PATH_NORMALISATION_VERSION,
  type ShippedAbandonedReason,
  type ShippedReadoutOutcome,
} from "@growthmind/shared";

import {
  createShippedChangesRepo,
  type ReportShippedChangeInput,
} from "../../src/repositories/shipped-changes.repo";
import * as schema from "../../src/schema";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type SeededProject,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("shipped-changes");

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const REPORTED_AGAIN_AT = new Date("2026-08-12T15:30:00.000Z");
const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");
// Deliberately different from the first: a re-report that carries its own later date must not
// move the clock, and passing the same date on both reports would prove nothing (HC-2).
const SECOND_READOUT_DUE_AT = new Date("2026-08-26T15:30:00.000Z");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function seedOrgAndProject(
  label: string,
): Promise<{ org: SeededOrgWithOwner; project: SeededProject }> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  return { org, project };
}

// The full change-key scope, never a limit-1 helper: a second row hides behind a "most recent"
// lookup and the dedup claim then reports success on a duplicated row (.ai/patterns.md #1).
async function changeRowsFor(params: {
  organizationId: string;
  projectId: string;
  page: string;
  controlLabel?: string;
}) {
  const conditions = [
    eq(schema.shippedChanges.organizationId, params.organizationId),
    eq(schema.shippedChanges.projectId, params.projectId),
    eq(schema.shippedChanges.page, params.page),
  ];

  if (params.controlLabel !== undefined) {
    conditions.push(eq(schema.shippedChanges.controlLabel, params.controlLabel));
  }

  return db
    .select()
    .from(schema.shippedChanges)
    .where(and(...conditions));
}

function reportInput(
  projectId: string,
  overrides: Partial<ReportShippedChangeInput> = {},
): ReportShippedChangeInput {
  return {
    projectId,
    page: "/reports",
    description: "CSV export",
    reportedAt: REPORTED_AT,
    readoutDueAt: READOUT_DUE_AT,
    ...overrides,
  };
}

describe("the change key holds one row and one clock per change", () => {
  test("a page-level change reported twice leaves exactly one row and one clock", async () => {
    const { org, project } = await seedOrgAndProject("page-level-twice");
    const repo = createShippedChangesRepo(db, org.ctx);

    await repo.reportShipped(reportInput(project.id, { description: "CSV export" }));
    await repo.reportShipped(
      reportInput(project.id, {
        description: "CSV export, now with column headings",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
      controlLabel: NO_CONTROL_LABEL,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("CSV export, now with column headings");
    expect(rows[0]?.readoutDueAt?.toISOString()).toBe(READOUT_DUE_AT.toISOString());
  });

  test("a page-level re-report stores the empty-string sentinel rather than a null label", async () => {
    const { org, project } = await seedOrgAndProject("page-level-sentinel");
    const repo = createShippedChangesRepo(db, org.ctx);

    await repo.reportShipped(reportInput(project.id));

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.controlLabel).toBe(NO_CONTROL_LABEL);
    expect(rows[0]?.controlLabel).not.toBeNull();
  });

  test("a control-level change reported twice leaves exactly one row and one clock", async () => {
    const { org, project } = await seedOrgAndProject("control-level-twice");
    const repo = createShippedChangesRepo(db, org.ctx);

    await repo.reportShipped(reportInput(project.id, { control: "Export CSV" }));
    await repo.reportShipped(
      reportInput(project.id, {
        control: "Export CSV",
        description: "Export CSV, second pass",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
      controlLabel: "Export CSV",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("Export CSV, second pass");
    expect(rows[0]?.readoutDueAt?.toISOString()).toBe(READOUT_DUE_AT.toISOString());
  });

  test("two reports differing only in control label leave two rows", async () => {
    const { org, project } = await seedOrgAndProject("label-fork");
    const repo = createShippedChangesRepo(db, org.ctx);

    await repo.reportShipped(reportInput(project.id, { control: "Export CSV" }));
    await repo.reportShipped(reportInput(project.id, { control: "Download CSV" }));

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => row.controlLabel).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["Download CSV", "Export CSV"]);
  });

  test("a page-level report and a control-level report on the same page are two changes", async () => {
    const { org, project } = await seedOrgAndProject("page-and-control");
    const repo = createShippedChangesRepo(db, org.ctx);

    await repo.reportShipped(reportInput(project.id));
    await repo.reportShipped(reportInput(project.id, { control: "Export CSV" }));

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(2);
  });

  test("two concurrent reports of one change key produce one row", async () => {
    const { org, project } = await seedOrgAndProject("concurrent");
    const repo = createShippedChangesRepo(db, org.ctx);
    const input = reportInput(project.id, { control: "Export CSV" });

    await Promise.all([repo.reportShipped(input), repo.reportShipped(input)]);

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
      controlLabel: "Export CSV",
    });

    expect(rows).toHaveLength(1);
  });
});

// The state moves here rather than through the service, so what the re-report meets is the row
// state alone and not a whole readout's worth of side effects.
async function moveTo(changeId: string, state: "read_out" | "closed" | "abandoned"): Promise<void> {
  await db
    .update(schema.shippedChanges)
    .set({ state, readOutAt: READOUT_DUE_AT })
    .where(eq(schema.shippedChanges.id, changeId));
}

describe("a re-report says which of the three things it did", () => {
  test("the first report claims reported and a second inside the window claims clock unchanged", async () => {
    const { org, project } = await seedOrgAndProject("claim-open");
    const repo = createShippedChangesRepo(db, org.ctx);

    const first = await repo.reportShipped(reportInput(project.id));
    expect(first.claim).toBe("reported");

    const again = await repo.reportShipped(
      reportInput(project.id, {
        description: "CSV export, now with column headings",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    expect(again.claim).toBe("clock_unchanged");
    expect(again.change.id).toBe(first.change.id);
    expect(again.change.description).toBe("CSV export, now with column headings");
    expect(again.change.readoutDueAt.toISOString()).toBe(READOUT_DUE_AT.toISOString());
  });

  for (const state of ["read_out", "closed"] as const) {
    test(`a report against a ${state} row claims already answered and rewrites nothing`, async () => {
      const { org, project } = await seedOrgAndProject(`claim-${state}`);
      const repo = createShippedChangesRepo(db, org.ctx);

      const first = await repo.reportShipped(reportInput(project.id));
      await moveTo(first.change.id, state);

      const again = await repo.reportShipped(
        reportInput(project.id, {
          description: "a different change on the same page",
          reportedAt: REPORTED_AGAIN_AT,
          readoutDueAt: SECOND_READOUT_DUE_AT,
        }),
      );

      expect(again.claim).toBe("already_answered");
      expect(again.change.id).toBe(first.change.id);

      // The verdict hangs off the description the founder was shown, so a report landing after
      // the answer may not edit it, and it starts no second clock either.
      const rows = await changeRowsFor({
        organizationId: org.organizationId,
        projectId: project.id,
        page: "/reports",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.description).toBe("CSV export");
      expect(rows[0]?.state).toBe(state);
      expect(rows[0]?.readoutDueAt?.toISOString()).toBe(READOUT_DUE_AT.toISOString());
    });
  }
});

async function abandonWith(changeId: string, reason: ShippedAbandonedReason): Promise<void> {
  await db
    .update(schema.shippedChanges)
    .set({ state: "abandoned", abandonedReason: reason, closedAt: READOUT_DUE_AT })
    .where(eq(schema.shippedChanges.id, changeId));
}

describe("a change we stopped watching was never answered, and is not told otherwise", () => {
  test("a re-report after we gave up asking says so, and claims no answer we never gave", async () => {
    const { org, project } = await seedOrgAndProject("abandoned-never-asked");
    const repo = createShippedChangesRepo(db, org.ctx);

    const first = await repo.reportShipped(reportInput(project.id));
    await moveToReadOutWith(first.change.id, "measured");
    await abandonWith(first.change.id, "never_asked");

    const again = await repo.reportShipped(
      reportInput(project.id, {
        description: "CSV export, second pass",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    // The readout was worked out and reached nobody, so "I already answered on that one" was a
    // sentence about a message the founder never received.
    expect(again.claim).toBe("stopped_watching");
    expect(again.change.id).toBe(first.change.id);

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("abandoned");
    expect(rows[0]?.abandonedReason).toBe("never_asked");
    expect(rows[0]?.description).toBe("CSV export");
    expect(rows[0]?.readoutDueAt.toISOString()).toBe(READOUT_DUE_AT.toISOString());
  });

  test("a change whose project went away is reported afresh rather than turned away", async () => {
    const { org, project } = await seedOrgAndProject("abandoned-project-gone");
    const repo = createShippedChangesRepo(db, org.ctx);

    const first = await repo.reportShipped(reportInput(project.id));
    await abandonWith(first.change.id, "project_gone");

    // R8: the row outlives its project, so the change key it holds no longer names a project any
    // report can supply. The founder rebuilding the same page under a new project is starting
    // over, and a refusal there would be about our bookkeeping rather than about their change.
    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));

    const rebuilt = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("abandoned-project-gone-rebuilt"),
    });

    const again = await repo.reportShipped(
      reportInput(rebuilt.id, {
        description: "CSV export, rebuilt",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    expect(again.claim).toBe("reported");
    expect(again.change.id).not.toBe(first.change.id);
    expect(again.change.readoutDueAt.toISOString()).toBe(SECOND_READOUT_DUE_AT.toISOString());

    // The abandoned row stays exactly where it is: it is the record that the project went away,
    // and the new report neither edits it nor reads a verdict out of it.
    const orphan = await db
      .select()
      .from(schema.shippedChanges)
      .where(eq(schema.shippedChanges.id, first.change.id));

    expect(orphan[0]?.state).toBe("abandoned");
    expect(orphan[0]?.projectId).toBeNull();
    expect(orphan[0]?.description).toBe("CSV export");
  });
});

// The outcome is what the readout was able to say, and it is the whole difference between a
// change we answered and one we only spoke about.
async function moveToReadOutWith(changeId: string, readoutOutcome: ShippedReadoutOutcome) {
  await db
    .update(schema.shippedChanges)
    .set({ state: "read_out", readOutAt: READOUT_DUE_AT, readoutOutcome })
    .where(eq(schema.shippedChanges.id, changeId));
}

describe("a readout that measured nothing does not close the change", () => {
  for (const outcome of SHIPPED_UNMEASURED_OUTCOMES) {
    test(`a re-report after a ${outcome} readout puts the same row back on a fresh clock`, async () => {
      const { org, project } = await seedOrgAndProject(`reopen-${outcome}`);
      const repo = createShippedChangesRepo(db, org.ctx);

      const first = await repo.reportShipped(reportInput(project.id));
      await moveToReadOutWith(first.change.id, outcome);

      const again = await repo.reportShipped(
        reportInput(project.id, {
          description: "CSV export, now with column headings",
          reportedAt: REPORTED_AGAIN_AT,
          readoutDueAt: SECOND_READOUT_DUE_AT,
        }),
      );

      expect(again.claim).toBe("watching_again");

      // Not a fork: HC-2's change key is untouched, so this is the same row on a new clock.
      expect(again.change.id).toBe(first.change.id);

      const rows = await changeRowsFor({
        organizationId: org.organizationId,
        projectId: project.id,
        page: "/reports",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe("reported");
      expect(rows[0]?.description).toBe("CSV export, now with column headings");
      expect(rows[0]?.readoutDueAt.toISOString()).toBe(SECOND_READOUT_DUE_AT.toISOString());
      expect(rows[0]?.readOutAt).toBeNull();
      expect(rows[0]?.readoutOutcome).toBeNull();
    });
  }

  test("a re-report after a readout that measured something is still turned away", async () => {
    const { org, project } = await seedOrgAndProject("reopen-measured");
    const repo = createShippedChangesRepo(db, org.ctx);

    const first = await repo.reportShipped(reportInput(project.id));
    await moveToReadOutWith(first.change.id, "measured");

    const again = await repo.reportShipped(
      reportInput(project.id, {
        description: "a different change on the same page",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    expect(again.claim).toBe("already_answered");

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("read_out");
    expect(rows[0]?.description).toBe("CSV export");
    expect(rows[0]?.readoutDueAt.toISOString()).toBe(READOUT_DUE_AT.toISOString());
  });

  // The claim differs because the two states are different facts — one carries an answer, the
  // other carries the reason we gave up — and neither is reopened.
  const SETTLED_CLAIMS = {
    closed: "already_answered",
    abandoned: "stopped_watching",
  } as const;

  for (const state of ["closed", "abandoned"] as const) {
    test(`a ${state} row that measured nothing keeps its terminal state and is not reopened`, async () => {
      // The reopen is a predicate of its own and never a relaxation of the ones beside it: a row
      // that has already settled is out of its reach whatever its readout managed to say.
      const { org, project } = await seedOrgAndProject(`no-reopen-${state}`);
      const repo = createShippedChangesRepo(db, org.ctx);

      const first = await repo.reportShipped(reportInput(project.id));
      await moveToReadOutWith(first.change.id, "too_few");
      await db
        .update(schema.shippedChanges)
        .set({ state })
        .where(eq(schema.shippedChanges.id, first.change.id));

      const again = await repo.reportShipped(
        reportInput(project.id, {
          description: "a different change on the same page",
          reportedAt: REPORTED_AGAIN_AT,
          readoutDueAt: SECOND_READOUT_DUE_AT,
        }),
      );

      expect(again.claim).toBe(SETTLED_CLAIMS[state]);

      const rows = await changeRowsFor({
        organizationId: org.organizationId,
        projectId: project.id,
        page: "/reports",
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe(state);
      expect(rows[0]?.description).toBe("CSV export");
      expect(rows[0]?.readoutDueAt.toISOString()).toBe(READOUT_DUE_AT.toISOString());
    });
  }
});

describe("the page must already be the normaliser's own output", () => {
  for (const page of ["/Reports", "/reports/", "https://app.example.com/reports?t=1"]) {
    test(`a report naming ${page} is refused before any SQL runs`, async () => {
      const { org, project } = await seedOrgAndProject(`unnormalised-${page.length.toString()}`);
      const repo = createShippedChangesRepo(db, org.ctx);

      await expect(repo.reportShipped(reportInput(project.id, { page }))).rejects.toThrow();

      // Stamping the normalisation version on a spelling the spine never wrote would leave a
      // row that matches nothing and forks its own change key.
      const rows = await db
        .select()
        .from(schema.shippedChanges)
        .where(eq(schema.shippedChanges.organizationId, org.organizationId));

      expect(rows).toHaveLength(0);
    });
  }

  test("the control: the normalised spelling of the same page is accepted", async () => {
    const { org, project } = await seedOrgAndProject("normalised-control");
    const repo = createShippedChangesRepo(db, org.ctx);

    const reported = await repo.reportShipped(reportInput(project.id, { page: "/reports" }));

    expect(reported.claim).toBe("reported");
    expect(reported.change.pageNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);
  });
});

describe("the readout date is the product's, and its absence is a refusal", () => {
  test("a report with no readout date is refused before any SQL runs", async () => {
    const { org, project } = await seedOrgAndProject("no-readout-date");
    const repo = createShippedChangesRepo(db, org.ctx);

    const withoutDate: Record<string, unknown> = { ...reportInput(project.id) };
    delete withoutDate.readoutDueAt;

    await expect(
      repo.reportShipped(withoutDate as unknown as ReportShippedChangeInput),
    ).rejects.toThrow();

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(0);
  });
});

describe("the derived columns are the product's and not the caller's", () => {
  test("a report with no control label stores the page corpus kind", async () => {
    const { org, project } = await seedOrgAndProject("corpus-page");
    const repo = createShippedChangesRepo(db, org.ctx);

    const { change } = await repo.reportShipped(reportInput(project.id));

    expect(change.corpusKind).toBe("page");
  });

  test("a report with a control label stores the recorded corpus kind", async () => {
    const { org, project } = await seedOrgAndProject("corpus-recorded");
    const repo = createShippedChangesRepo(db, org.ctx);

    const { change } = await repo.reportShipped(reportInput(project.id, { control: "Export CSV" }));

    expect(change.corpusKind).toBe("recorded");
  });

  test("a caller-supplied corpus kind cannot override the one derived from the label", async () => {
    const { org, project } = await seedOrgAndProject("corpus-forged");
    const repo = createShippedChangesRepo(db, org.ctx);

    const forged = {
      ...reportInput(project.id, { control: "Export CSV" }),
      corpusKind: "page",
    } as unknown as ReportShippedChangeInput;

    const { change } = await repo.reportShipped(forged);

    expect(change.corpusKind).toBe("recorded");
  });

  test("the stored page normalisation version is the current constant", async () => {
    const { org, project } = await seedOrgAndProject("normalisation-version");
    const repo = createShippedChangesRepo(db, org.ctx);

    const { change } = await repo.reportShipped(reportInput(project.id));

    expect(change.pageNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);
  });
});

describe("a renamed control forks the change, and the fork is asserted rather than silent", () => {
  test("renaming a control mints a second row and leaves the first row's clock running", async () => {
    const { org, project } = await seedOrgAndProject("control-rename");
    const repo = createShippedChangesRepo(db, org.ctx);

    const before = await repo.reportShipped(reportInput(project.id, { control: "Export CSV" }));
    const after = await repo.reportShipped(
      reportInput(project.id, {
        control: "Download CSV",
        reportedAt: REPORTED_AGAIN_AT,
        readoutDueAt: SECOND_READOUT_DUE_AT,
      }),
    );

    const rows = await changeRowsFor({
      organizationId: org.organizationId,
      projectId: project.id,
      page: "/reports",
    });

    expect(rows).toHaveLength(2);
    expect(after.change.id).not.toBe(before.change.id);

    const original = rows.find((row) => row.id === before.change.id);
    expect(original?.state).toBe("reported");
    expect(original?.readoutDueAt?.toISOString()).toBe(READOUT_DUE_AT.toISOString());

    const renamed = rows.find((row) => row.id === after.change.id);
    expect(renamed?.readoutDueAt?.toISOString()).toBe(SECOND_READOUT_DUE_AT.toISOString());
  });
});
