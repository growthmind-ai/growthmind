import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIX_SPEC_PAYLOAD_VERSION } from "@growthmind/core";
import {
  FIX_RESULTS_RULE_VERSION,
  FIX_RESULTS_WINDOW_DAYS,
  summarySourceSchema,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";

import {
  fixSpecPayload,
  findingCountRow,
  RENDERABLE_SURFACE,
  UNRENDERABLE_SURFACE,
} from "../helpers/fix-spec-payload";
import { createDeliveriesRepo } from "../../src/repositories/deliveries.repo";
import { createFindingPayloadsRepo } from "../../src/repositories/finding-payloads.repo";
import { createFindingsRepo } from "../../src/repositories/findings.repo";
import { createFixesRepo } from "../../src/repositories/fixes.repo";
import { createFixesService } from "../../src/services/fixes.service";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  makeTenantContext,
  seedAnalysisRun,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
  type SeededOrgWithOwner,
} from "../../src/testing";

const NAMES = laneNames("fixes-service");

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RESULTS_WINDOW_MS = FIX_RESULTS_WINDOW_DAYS * MS_PER_DAY;

interface SeededFinding {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly findingId: string;
}

interface SeedOptions {
  readonly label: string;
  readonly surface?: string;
  readonly withPayload?: boolean;

  readonly projectId?: string;
}

async function seedFinding(db: TestDb, options: SeedOptions): Promise<SeededFinding> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(options.label),
    userName: NAMES.userName(options.label),
    email: NAMES.email(options.label),
  });

  return seedFindingIn(db, org, options);
}

async function seedFindingIn(
  db: TestDb,
  org: SeededOrgWithOwner,
  options: SeedOptions,
): Promise<SeededFinding> {
  const projectId =
    options.projectId ??
    (
      await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName(options.label),
      })
    ).id;
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId });
  const surface = options.surface ?? RENDERABLE_SURFACE;

  const finding = await createFindingsRepo(db, org.ctx).persist({
    projectId,
    runId: run.id,
    signature: sha256Hex(`fixes.service.test:${options.label}`),
    signatureVersion: 1,
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: "Two of every three people stop at the payment step",
    context: ["Of 28 people who reached the payment step, 19 did not finish."],
    finalClass: "confusing",
    surface,
    surfaceNormalisationVersion: 1,
    counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: `funnel_dropoff:surface=${surface}`,
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
  });

  if (options.withPayload !== false) {
    await createFindingPayloadsRepo(db, org.ctx).upsertFor({
      findingId: finding.id,
      payload: fixSpecPayload({ surface }),
    });
  }

  return { org, projectId, findingId: finding.id };
}

async function teammateContextFor(db: TestDb, org: SeededOrgWithOwner): Promise<TenantContext> {
  const teammate = await seedUser(db, {
    name: NAMES.userName("teammate"),
    email: `teammate-${org.organizationId}@example.com`,
  });
  await seedMember(db, {
    organizationId: org.organizationId,
    userId: teammate.id,
    role: "member",
  });

  return makeTenantContext({
    userId: teammate.id,
    organizationId: org.organizationId,
    organizationName: org.organizationName,
    role: "member",
  });
}

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo", "coverage"]);

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function isTestPath(rel: string): boolean {
  return rel.includes("__tests__/") || rel.includes(".test.") || rel.includes(".spec.");
}

const UNREACHABLE_STATUS_WRITE =
  /status\s*:\s*["'](?:awaiting_verification|verified|withdrawn)["']/;

const statusWriters = (files: readonly { path: string; source: string }[]): readonly string[] =>
  files
    .filter((file) => !isTestPath(file.path) && UNREACHABLE_STATUS_WRITE.test(file.source))
    .map((file) => file.path);

describe("fixes service", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("derives every fix field from the finding row when the caller passes only an id", async () => {
    const seeded = await seedFinding(db, { label: "derives" });
    const service = createFixesService(db, seeded.org.ctx);

    expect(service.openFor.length).toBe(1);

    const result = await service.openFor(seeded.findingId);

    expect(result.outcome).toBe("opened");
    if (result.outcome !== "opened") throw new Error("expected the first press to open a fix");

    expect(result.fix.organizationId).toBe(seeded.org.organizationId);
    expect(result.fix.projectId).toBe(seeded.projectId);
    expect(result.fix.findingId).toBe(seeded.findingId);
    expect(result.fix.openedBy).toBe(seeded.org.ctx.userId);
    expect(result.fix.status).toBe("open");
  });

  it("mints one fix when the button is pressed twice", async () => {
    const seeded = await seedFinding(db, { label: "pressed-twice" });
    const service = createFixesService(db, seeded.org.ctx);

    const first = await service.openFor(seeded.findingId);
    const second = await service.openFor(seeded.findingId);

    expect(first.outcome).toBe("opened");
    expect(second.outcome).toBe("already_open");
    if (first.outcome !== "opened" || second.outcome !== "already_open") {
      throw new Error("expected one open and one already-open outcome");
    }
    expect(second.fix.id).toBe(first.fix.id);

    expect(await createFixesRepo(db, seeded.org.ctx).countOpen({ projectId: null })).toBe(1);
  });

  it("mints one fix when two organization members press within the same tick", async () => {
    const seeded = await seedFinding(db, { label: "same-tick" });
    const teammateCtx = await teammateContextFor(db, seeded.org);

    const results = await Promise.all([
      createFixesService(db, seeded.org.ctx).openFor(seeded.findingId),
      createFixesService(db, teammateCtx).openFor(seeded.findingId),
    ]);

    const opened = results.filter((result) => result.outcome === "opened");
    expect(opened).toHaveLength(1);

    const ids = new Set(
      results.flatMap((result) =>
        result.outcome === "opened" || result.outcome === "already_open" ? [result.fix.id] : [],
      ),
    );
    expect(ids.size).toBe(1);

    expect(await createFixesRepo(db, seeded.org.ctx).countOpen({ projectId: null })).toBe(1);
  });

  it("mints one fix when the organization has two delivery channels", async () => {
    const seeded = await seedFinding(db, { label: "two-channels" });
    const deliveries = createDeliveriesRepo(db, seeded.org.ctx);
    const claimedAt = new Date("2026-07-31T09:00:00.000Z");

    for (const channelId of ["C0FINDINGS", "C0ENGINEERING"]) {
      await deliveries.claimForPost({
        projectId: seeded.projectId,
        findingId: seeded.findingId,
        signature: sha256Hex("fixes.service.test:two-channels"),
        channelId,
        claimedAt,
        staleClaimsBefore: new Date(claimedAt.getTime() - 60 * 60 * 1_000),
      });
    }

    const service = createFixesService(db, seeded.org.ctx);
    const fromFindings = await service.openFor(seeded.findingId);
    const fromEngineering = await service.openFor(seeded.findingId);

    expect(fromFindings.outcome).toBe("opened");
    expect(fromEngineering.outcome).toBe("already_open");
    expect(await createFixesRepo(db, seeded.org.ctx).countOpen({ projectId: null })).toBe(1);
  });

  it("refuses to mint from a finding persisted before the payload existed", async () => {
    const seeded = await seedFinding(db, { label: "no-payload", withPayload: false });

    const result = await createFixesService(db, seeded.org.ctx).openFor(seeded.findingId);

    expect(result.outcome).toBe("no_payload");
    expect(await createFixesRepo(db, seeded.org.ctx).findForFinding(seeded.findingId)).toBeNull();
    expect(await createFixesRepo(db, seeded.org.ctx).countOpen({ projectId: null })).toBe(0);
  });

  it("refuses to mint from a payload that cannot be rendered", async () => {
    const seeded = await seedFinding(db, {
      label: "unrenderable",
      surface: UNRENDERABLE_SURFACE,
    });

    const result = await createFixesService(db, seeded.org.ctx).openFor(seeded.findingId);

    expect(result.outcome).toBe("unrenderable");
    expect(await createFixesRepo(db, seeded.org.ctx).findForFinding(seeded.findingId)).toBeNull();
    expect(await createFixesRepo(db, seeded.org.ctx).countOpen({ projectId: null })).toBe(0);
  });

  it("mints no fix against another organization's finding", async () => {
    const seeded = await seedFinding(db, { label: "cross-tenant-a" });
    const otherOrg = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("cross-tenant-b"),
      userName: NAMES.userName("cross-tenant-b"),
      email: NAMES.email("cross-tenant-b"),
    });

    const result = await createFixesService(db, otherOrg.ctx).openFor(seeded.findingId);

    expect(result.outcome).toBe("finding_not_found");
    expect(await createFixesRepo(db, otherOrg.ctx).countOpen({ projectId: null })).toBe(0);
    expect(await createFixesRepo(db, seeded.org.ctx).findForFinding(seeded.findingId)).toBeNull();
  });

  it("freezes results-by at mint and never moves it", async () => {
    const seeded = await seedFinding(db, { label: "results-by" });
    const service = createFixesService(db, seeded.org.ctx);

    const first = await service.openFor(seeded.findingId);
    if (first.outcome !== "opened") throw new Error("expected the first press to open a fix");

    expect(first.fix.resultsBy.getTime() - first.fix.openedAt.getTime()).toBe(RESULTS_WINDOW_MS);
    expect(first.fix.resultsByRuleVersion).toBe(FIX_RESULTS_RULE_VERSION);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const later = await service.openFor(seeded.findingId);
    if (later.outcome !== "already_open") {
      throw new Error("expected the second press to find the fix already open");
    }

    expect(later.fix.resultsBy.getTime()).toBe(first.fix.resultsBy.getTime());
    expect(later.fix.openedAt.getTime()).toBe(first.fix.openedAt.getTime());
  });

  it("starts a fix at attempt one with nothing already landed", async () => {
    const seeded = await seedFinding(db, { label: "attempt-one" });

    const result = await createFixesService(db, seeded.org.ctx).openFor(seeded.findingId);
    if (result.outcome !== "opened") throw new Error("expected the press to open a fix");

    expect(result.fix.attempt).toBe(1);
    expect(result.fix.alreadyLanded).toEqual([]);
    expect(result.fix.status).toBe("open");
  });

  it("moves no fix off open, because nothing does", async () => {
    // The detector must fire on the edit it forbids before it claims the tree is clean.
    expect(
      statusWriters([
        { path: "packages/db/src/services/fixes.service.ts", source: `status: "verified",` },
      ]),
    ).toEqual(["packages/db/src/services/fixes.service.ts"]);
    expect(
      statusWriters([
        {
          path: "packages/db/__tests__/services/fixes.service.test.ts",
          source: `status: "verified"`,
        },
      ]),
    ).toEqual([]);

    const scanned = ["apps", "packages", "worker", "scripts"]
      .flatMap((dir) => listSourceFiles(path.join(REPO_ROOT, dir)))
      .map((file) => ({ path: relative(file), source: readFileSync(file, "utf8") }));
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.filter((file) => !isTestPath(file.path)).length).toBeLessThan(scanned.length);

    expect(statusWriters(scanned)).toEqual([]);

    const seeded = await seedFinding(db, { label: "stays-open" });
    const service = createFixesService(db, seeded.org.ctx);

    expect(Object.keys(service).toSorted()).toEqual([
      "listOpen",
      "openFor",
      "readFinding",
      "readFix",
    ]);

    const result = await service.openFor(seeded.findingId);
    if (result.outcome !== "opened") throw new Error("expected the press to open a fix");
    expect(result.fix.status).toBe("open");
  });

  // B-031's churn, as production can actually perform it: `persist` is insert-or-fetch on
  // (organization_id, project_id, signature) and the repo declares no update, so a re-derived
  // signature arrives as a new finding row, never as a mutation of the old one. The fix identity
  // is (organization_id, finding_id), so the fork gets its own fix — correct, because a fix
  // points at the finding that evidences it and the forked row carries its own evidence. The
  // cost B-031 names is here in the assertions: one problem, two open fixes.
  it("mints a second fix when a re-derived finding forks into a new row, never attaching it to the old fix", async () => {
    const seeded = await seedFinding(db, { label: "identity-churn" });
    const service = createFixesService(db, seeded.org.ctx);

    const first = await service.openFor(seeded.findingId);
    if (first.outcome !== "opened") throw new Error("expected the first press to open a fix");

    const forked = await seedFindingIn(db, seeded.org, {
      label: "identity-churn-re-derived",
      projectId: seeded.projectId,
    });
    expect(forked.findingId).not.toBe(seeded.findingId);

    const afterFork = await service.openFor(forked.findingId);

    expect(afterFork.outcome).toBe("opened");
    if (afterFork.outcome !== "opened") {
      throw new Error("expected the forked finding to mint its own fix");
    }
    expect(afterFork.fix.id).not.toBe(first.fix.id);
    expect(afterFork.fix.findingId).toBe(forked.findingId);

    const repo = createFixesRepo(db, seeded.org.ctx);
    expect((await repo.findForFinding(seeded.findingId))?.id).toBe(first.fix.id);
    expect(await repo.countOpen({ projectId: null })).toBe(2);

    const page = await service.listOpen({ projectId: null, limit: 25 });
    expect(page.totalOpen).toBe(2);
    expect(page.rows.map((row) => row.findingId).toSorted()).toEqual(
      [seeded.findingId, forked.findingId].toSorted(),
    );
  });

  it("omits a fix whose payload has gone from both the list and its total", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("payload-gone"),
      userName: NAMES.userName("payload-gone"),
      email: NAMES.email("payload-gone"),
    });
    const kept = await seedFindingIn(db, org, { label: "payload-gone-kept" });
    const lost = await seedFindingIn(db, org, { label: "payload-gone-lost" });

    const service = createFixesService(db, org.ctx);
    await service.openFor(kept.findingId);
    await service.openFor(lost.findingId);

    const before = await service.listOpen({ projectId: null, limit: 25 });
    expect(before.rows).toHaveLength(2);
    expect(before.totalOpen).toBe(2);

    await db.execute(sql`delete from finding_payloads where finding_id = ${lost.findingId}`);

    const after = await service.listOpen({ projectId: null, limit: 25 });

    expect(after.rows).toHaveLength(1);
    expect(after.totalOpen).toBe(1);
    expect(after.rows.length).toBeLessThanOrEqual(after.totalOpen);
    expect(after.rows.map((row) => row.findingId)).toEqual([kept.findingId]);
  });

  it("omits a fix whose payload this build cannot read from both the list and its total", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("payload-unreadable"),
      userName: NAMES.userName("payload-unreadable"),
      email: NAMES.email("payload-unreadable"),
    });
    const first = await seedFindingIn(db, org, { label: "payload-unreadable-first" });
    const second = await seedFindingIn(db, org, { label: "payload-unreadable-second" });
    const stale = await seedFindingIn(db, org, { label: "payload-unreadable-stale" });

    const service = createFixesService(db, org.ctx);
    for (const seeded of [first, second, stale]) {
      await service.openFor(seeded.findingId);
    }

    const before = await service.listOpen({ projectId: null, limit: 25 });
    expect(before.rows).toHaveLength(3);
    expect(before.totalOpen).toBe(3);

    // What a `FIX_SPEC_PAYLOAD_VERSION` bump leaves behind: the row is present and readable
    // by Postgres, and rehydration refuses it. That is what separates this from a deleted
    // payload, which SQL can see is gone.
    await db.execute(
      sql`update finding_payloads set payload_version = ${FIX_SPEC_PAYLOAD_VERSION + 1} where finding_id = ${stale.findingId}`,
    );
    expect(
      await createFindingPayloadsRepo(db, org.ctx).findForFinding(stale.findingId),
    ).not.toBeNull();

    const after = await service.listOpen({ projectId: null, limit: 25 });

    expect(after.rows.map((row) => row.findingId).toSorted()).toEqual(
      [first.findingId, second.findingId].toSorted(),
    );
    expect(after.totalOpen).toBe(2);
    expect(after.rows.length).toBeLessThanOrEqual(after.totalOpen);

    // A total the page cannot fill is the reported symptom, so ask for a page it must fill:
    // the one row returned is readable, and the total counts only the readable rows behind it.
    const paged = await service.listOpen({ projectId: null, limit: 1 });
    expect(paged.rows).toHaveLength(1);
    expect(paged.totalOpen).toBe(2);
    expect(paged.rows.map((row) => row.findingId)).not.toContain(stale.findingId);
  });
});
