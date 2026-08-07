import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIX_SPEC_PAYLOAD_VERSION, WORTH_WEIGHT_VERSION, weightOfRole } from "@growthmind/core";
import {
  FIX_RESULTS_RULE_VERSION,
  FIX_RESULTS_WINDOW_DAYS,
  RESIDUAL_PII_KINDS,
  setLogSink,
  summarySourceSchema,
  type LogRecord,
  type TenantContext,
  URL_PATH_NORMALISATION_VERSION,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { sql } from "drizzle-orm";

import {
  fixSpecPayload,
  findingCountRow,
  FORBIDDEN_SURFACE,
  RENDERABLE_SURFACE,
  UNRENDERABLE_SURFACE,
} from "../helpers/fix-spec-payload";
import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createGrowthContextRepo } from "../../src/repositories/growth-context.repo";
import { createDeliveriesRepo } from "../../src/repositories/deliveries.repo";
import { createFindingPayloadsRepo } from "../../src/repositories/finding-payloads.repo";
import { createFindingsRepo, type MeasuredCountRow } from "../../src/repositories/findings.repo";
import { createFixesRepo } from "../../src/repositories/fixes.repo";
import type { ScopedDb } from "../../src/repositories/types";
import { createFixesService } from "../../src/services/fixes.service";
import { sha256Hex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  makeTenantContext,
  scannedTextFor,
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

const OFFENDER = "jane.doe@acme.example";

const HOLD_REASONS = ["residual_pii", "unreadable"] as const;

const FIXTURES_OWNER = "ADD Wave 1.4 (packages/db/src/testing/fixtures.ts, seedUnscannedFinding)";

const CLEAN_TEXT = scannedTextFor("Two of every three people stop at the payment step", [
  "Of 28 people who reached the payment step, 19 did not finish.",
]);

type SeedUnscannedFinding = (
  db: ScopedDb,
  params: {
    readonly ctx: TenantContext;
    readonly projectId: string;
    readonly runId: string;
    readonly headline: string;
    readonly context: readonly string[];
    readonly signature?: string;
    readonly surface?: string;
    readonly counts?: readonly MeasuredCountRow[];
    readonly createdAt?: Date;
  },
) => Promise<{ readonly id: string }>;

const loadSeedUnscannedFinding = (): Promise<SeedUnscannedFinding> =>
  loadUnderConstruction<SeedUnscannedFinding>({
    modulePath: underConstructionSpecifier("packages/db/src/testing/fixtures"),
    exportName: "seedUnscannedFinding",
    ownedBy: FIXTURES_OWNER,
  });

interface SeededFinding {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly findingId: string;
}

interface SeedOptions {
  readonly label: string;
  readonly surface?: string;
  readonly affected?: number;
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
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
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
      payload: fixSpecPayload({ surface, affected: options.affected }),
    });
  }

  return { org, projectId, findingId: finding.id };
}

// A payload is attached so the row is a candidate on every other ground: what removes it
// from the page is the hold, not a missing impact count.
async function seedHeldFindingIn(
  db: TestDb,
  seed: SeedUnscannedFinding,
  org: SeededOrgWithOwner,
  options: { readonly label: string; readonly projectId: string },
): Promise<{ readonly id: string }> {
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: options.projectId });

  const seeded = await seed(db, {
    ctx: org.ctx,
    projectId: options.projectId,
    runId: run.id,
    headline: `Two of every three people stop here, and one wrote in as ${OFFENDER}`,
    context: ["Of 28 people who reached the last step, 19 did not finish."],
    signature: sha256Hex(`fixes.service.test:${options.label}`),
    surface: RENDERABLE_SURFACE,
    counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
  });

  await createFindingPayloadsRepo(db, org.ctx).upsertFor({
    findingId: seeded.id,
    payload: fixSpecPayload({ surface: RENDERABLE_SURFACE }),
  });

  return seeded;
}

// Written unscanned so the stored context is exactly what the test names: `persist` only
// accepts text a mint has already branded, which is the shape under test here.
async function seedRawContext(
  db: TestDb,
  seed: SeedUnscannedFinding,
  label: string,
  context: readonly string[],
): Promise<{ readonly org: SeededOrgWithOwner; readonly id: string }> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const projectId = (
    await seedProject(db, { organizationId: org.organizationId, name: NAMES.projectName(label) })
  ).id;
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId });

  const seeded = await seed(db, {
    ctx: org.ctx,
    projectId,
    runId: run.id,
    headline: CLEAN_TEXT.headline,
    context,
    signature: sha256Hex(`fixes.service.test:${label}`),
    surface: RENDERABLE_SURFACE,
    counts: [findingCountRow(28, 28), findingCountRow(19, 28)],
  });

  await createFindingPayloadsRepo(db, org.ctx).upsertFor({
    findingId: seeded.id,
    payload: fixSpecPayload({ surface: RENDERABLE_SURFACE }),
  });

  return { org, id: seeded.id };
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

  test("listOpen drops a row whose finding text is held and totalOpen falls with it", async () => {
    const seedUnscannedFinding = await loadSeedUnscannedFinding();

    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("pii-list"),
      userName: NAMES.userName("pii-list"),
      email: NAMES.email("pii-list"),
    });
    const projectId = (
      await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("pii-list"),
      })
    ).id;

    const first = await seedFindingIn(db, org, { label: "pii-list-first", projectId });
    const second = await seedFindingIn(db, org, { label: "pii-list-second", projectId });
    const held = await seedHeldFindingIn(db, seedUnscannedFinding, org, {
      label: "pii-list-held",
      projectId,
    });

    const service = createFixesService(db, org.ctx);
    for (const findingId of [first.findingId, second.findingId, held.id]) {
      expect((await service.openFor(findingId)).outcome).toBe("opened");
    }

    const OPEN_FIXES = 3;
    expect(await createFixesRepo(db, org.ctx).countOpen({ projectId })).toBe(OPEN_FIXES);

    const page = await service.listOpen({ projectId, limit: 25 });

    // The denominator moves with the row. A total the page can never fill is the defect
    // the payload-version rows above already pin; a hold must not reintroduce it.
    expect(page.rows).toHaveLength(OPEN_FIXES - 1);
    expect(page.totalOpen).toBe(OPEN_FIXES - 1);
    expect(page.rows.map((row) => row.findingId).toSorted()).toEqual(
      [first.findingId, second.findingId].toSorted(),
    );
    expect(JSON.stringify(page)).not.toContain(OFFENDER);
  });

  test("readFinding returns null for a held row rather than throwing or returning a partial object", async () => {
    const seedUnscannedFinding = await loadSeedUnscannedFinding();

    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("pii-read"),
      userName: NAMES.userName("pii-read"),
      email: NAMES.email("pii-read"),
    });
    const projectId = (
      await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("pii-read"),
      })
    ).id;
    const held = await seedHeldFindingIn(db, seedUnscannedFinding, org, {
      label: "pii-read-held",
      projectId,
    });

    const logged: LogRecord[] = [];
    const restore = setLogSink((record) => {
      logged.push(record);
    });

    try {
      expect(await createFixesService(db, org.ctx).readFinding(held.id)).toBeNull();

      // `warn`: every legacy row is unscanned, so one read over them must not emit an
      // error line per row.
      const lines = logged.filter(
        (record) => record.level === "warn" && record.fields.findingId === held.id,
      );
      expect(logged.filter((record) => record.level === "error")).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(HOLD_REASONS as readonly unknown[]).toContain(lines[0]?.fields.reason);
      expect([...RESIDUAL_PII_KINDS, null] as readonly unknown[]).toContain(lines[0]?.fields.kind);

      for (const record of logged) {
        expect(record.message).not.toContain(OFFENDER);
        expect(JSON.stringify(record.fields)).not.toContain(OFFENDER);
      }
    } finally {
      restore();
    }
  });

  test("readFinding trims the detail it returns, so padding a row cannot widen get_finding's answer", async () => {
    const seeded = await seedRawContext(db, await loadSeedUnscannedFinding(), "padded-detail", [
      "  ",
      CLEAN_TEXT.context[0],
      "  ",
    ]);

    const read = await createFixesService(db, seeded.org.ctx).readFinding(seeded.id);
    const detail: string = read?.detail ?? "";

    expect(detail).toBe(CLEAN_TEXT.context[0]);
    expect(detail).toBe(detail.trim());
  });

  test("a context that is nothing but padding still falls back to the headline", async () => {
    // The value tested for emptiness and the value returned are the same one, so a row
    // that reads as empty cannot be returned as whitespace.
    const seeded = await seedRawContext(db, await loadSeedUnscannedFinding(), "empty-detail", [
      "  ",
      "  ",
    ]);

    const read = await createFixesService(db, seeded.org.ctx).readFinding(seeded.id);

    expect(read?.detail).toBe(CLEAN_TEXT.headline);
  });
});

describe("fixes service — the §5 deny list", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("refuses to mint a fix on a page where the customer takes money", async () => {
    const seeded = await seedFinding(db, { label: "forbidden-money", surface: FORBIDDEN_SURFACE });

    const result = await createFixesService(db, seeded.org.ctx).openFor(seeded.findingId);

    expect(result).toMatchObject({
      outcome: "surface_forbidden",
      reason: "pricing_or_billing",
      surface: FORBIDDEN_SURFACE,
    });
  });

  it("mints nothing at all, so the refusal cannot be worked around by asking twice", async () => {
    const seeded = await seedFinding(db, { label: "forbidden-twice", surface: "/account/login" });
    const service = createFixesService(db, seeded.org.ctx);

    expect(await service.openFor(seeded.findingId)).toMatchObject({ outcome: "surface_forbidden" });
    expect(await service.openFor(seeded.findingId)).toMatchObject({ outcome: "surface_forbidden" });

    expect(await createFixesRepo(db, seeded.org.ctx).findForFinding(seeded.findingId)).toBeNull();
  });

  it("leaves the finding itself untouched — the evidence is refused nothing", async () => {
    // The deny list governs what may be proposed as work, never what may be observed.
    // Suppressing the finding would hide a real drop-off from the customer.
    const seeded = await seedFinding(db, { label: "forbidden-reads", surface: "/legal/terms" });

    const finding = await createFixesService(db, seeded.org.ctx).readFinding(seeded.findingId);

    expect(finding).not.toBeNull();
    expect(finding?.surface).toBe("/legal/terms");
    expect(finding?.fixId).toBeNull();
  });

  it("mints once the customer confirms the page is theirs to change", async () => {
    const seeded = await seedFinding(db, { label: "forbidden-freed", surface: FORBIDDEN_SURFACE });

    await createGrowthContextRepo(db, seeded.org.ctx).save({
      projectId: seeded.projectId,
      surfaces: [],
      confirmedChangeable: [FORBIDDEN_SURFACE],
    });

    expect(await createFixesService(db, seeded.org.ctx).openFor(seeded.findingId)).toMatchObject({
      outcome: "opened",
    });
  });

  it("confines the confirmation to the organisation that made it", async () => {
    const mine = await seedFinding(db, { label: "forbidden-mine", surface: FORBIDDEN_SURFACE });
    const theirs = await seedFinding(db, { label: "forbidden-theirs", surface: FORBIDDEN_SURFACE });

    await createGrowthContextRepo(db, mine.org.ctx).save({
      projectId: mine.projectId,
      surfaces: [],
      confirmedChangeable: [FORBIDDEN_SURFACE],
    });

    expect(await createFixesService(db, theirs.org.ctx).openFor(theirs.findingId)).toMatchObject({
      outcome: "surface_forbidden",
    });
  });
});

describe("fixes service — listOpen ranks by expected value", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("puts a smaller problem on a surface that matters above a larger one that does not", async () => {
    // `list_open_fixes` tells a coding agent it returns the most urgent first. Before this,
    // it returned them in deadline order.
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("rank-org"),
      userName: NAMES.userName("rank-org"),
      email: NAMES.email("rank-org"),
    });
    const projectId = (
      await seedProject(db, { organizationId: org.organizationId, name: NAMES.projectName("rank") })
    ).id;

    const noisy = await seedFindingIn(db, org, {
      label: "rank-noisy",
      projectId,
      surface: "/projects/reports",
      affected: 24,
    });
    const activation = await seedFindingIn(db, org, {
      label: "rank-activation",
      projectId,
      surface: "/onboarding/connect",
      affected: 6,
    });

    const service = createFixesService(db, org.ctx);
    await service.openFor(noisy.findingId);
    await service.openFor(activation.findingId);

    await createGrowthContextRepo(db, org.ctx).save({
      projectId,
      surfaces: [
        {
          surface: "/onboarding/connect",
          role: "first_value",
          basis: "stated_by_customer",
          confirmedAt: new Date("2026-08-01T10:00:00.000Z"),
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });

    const page = await service.listOpen({ projectId, limit: 25 });

    expect(page.rows.map((row) => row.findingId)).toEqual([activation.findingId, noisy.findingId]);
  });

  it("falls back to the deadline order when nothing has been roled", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("rank-plain"),
      userName: NAMES.userName("rank-plain"),
      email: NAMES.email("rank-plain"),
    });
    const projectId = (
      await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("rank-plain"),
      })
    ).id;

    const smaller = await seedFindingIn(db, org, {
      label: "rank-plain-small",
      projectId,
      surface: "/projects/reports",
      affected: 4,
    });
    const larger = await seedFindingIn(db, org, {
      label: "rank-plain-large",
      projectId,
      surface: "/projects/exports",
      affected: 21,
    });

    const service = createFixesService(db, org.ctx);
    await service.openFor(smaller.findingId);
    await service.openFor(larger.findingId);

    const page = await service.listOpen({ projectId, limit: 25 });

    expect(page.rows.map((row) => row.findingId)).toEqual([larger.findingId, smaller.findingId]);
  });

  it("carries what outranked the biggest count, so the order can be read off the row", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("rank-basis"),
      userName: NAMES.userName("rank-basis"),
      email: NAMES.email("rank-basis"),
    });
    const projectId = (
      await seedProject(db, {
        organizationId: org.organizationId,
        name: NAMES.projectName("rank-basis"),
      })
    ).id;

    const BIGGEST = 22;
    const SMALLER = 5;

    const busiest = await seedFindingIn(db, org, {
      label: "rank-basis-busiest",
      projectId,
      surface: "/projects/reports",
      affected: BIGGEST,
    });
    const valuable = await seedFindingIn(db, org, {
      label: "rank-basis-valuable",
      projectId,
      surface: "/onboarding/connect",
      affected: SMALLER,
    });

    const service = createFixesService(db, org.ctx);
    await service.openFor(busiest.findingId);
    await service.openFor(valuable.findingId);

    await createGrowthContextRepo(db, org.ctx).save({
      projectId,
      surfaces: [
        {
          surface: "/onboarding/connect",
          role: "first_value",
          basis: "stated_by_customer",
          confirmedAt: new Date("2026-08-01T10:00:00.000Z"),
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });

    const page = await service.listOpen({ projectId, limit: 25 });
    const [first, second] = page.rows;
    if (!first || !second) throw new Error("expected both open fixes back");

    // The counter-intuitive case, stated first: the row a founder would expect at the top
    // because it hit the most people is second.
    expect(second.findingId).toBe(busiest.findingId);
    expect(second.impact.numerator).toBeGreaterThan(first.impact.numerator);

    // Everything the page needs to say why, without arithmetic and without a second copy
    // of the weight table.
    expect(first.rankedBy).toEqual({
      score: SMALLER * weightOfRole("first_value"),
      affected: SMALLER,
      weight: weightOfRole("first_value"),
      weightVersion: WORTH_WEIGHT_VERSION,
      role: "first_value",
    });
    expect(second.rankedBy).toEqual({
      score: BIGGEST * weightOfRole("unknown"),
      affected: BIGGEST,
      weight: weightOfRole("unknown"),
      weightVersion: WORTH_WEIGHT_VERSION,
      role: "unknown",
    });

    expect(first.rankedBy.score).toBeGreaterThan(second.rankedBy.score);
    expect(second.rankedBy.role).toBe("unknown");
  });
});

describe("fixes service — readFix separates a missing fix from a held one", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("answers not_found only when no fix of this organization's exists", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("read-absent"),
      userName: NAMES.userName("read-absent"),
      email: NAMES.email("read-absent"),
    });

    const service = createFixesService(db, org.ctx);

    expect(await service.readFix(crypto.randomUUID())).toEqual({ outcome: "not_found" });

    const seeded = await seedFindingIn(db, org, { label: "read-absent-present" });
    const opened = await service.openFor(seeded.findingId);
    if (opened.outcome !== "opened") throw new Error("expected the press to open a fix");

    const read = await service.readFix(opened.fix.id);
    expect(read.outcome).toBe("read");
  });

  it("answers unrenderable for a fix we hold and cannot read back, naming its finding", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("read-held"),
      userName: NAMES.userName("read-held"),
      email: NAMES.email("read-held"),
    });

    const stale = await seedFindingIn(db, org, { label: "read-held-stale" });
    const dropped = await seedFindingIn(db, org, { label: "read-held-dropped" });

    const service = createFixesService(db, org.ctx);
    const staleFix = await service.openFor(stale.findingId);
    const droppedFix = await service.openFor(dropped.findingId);
    if (staleFix.outcome !== "opened" || droppedFix.outcome !== "opened") {
      throw new Error("expected both presses to open a fix");
    }

    // A `FIX_SPEC_PAYLOAD_VERSION` bump leaves the row readable by Postgres and refused by
    // rehydration; a deleted payload is the other way round. Both are a fix we are holding.
    await db.execute(
      sql`update finding_payloads set payload_version = ${FIX_SPEC_PAYLOAD_VERSION + 1} where finding_id = ${stale.findingId}`,
    );
    await db.execute(sql`delete from finding_payloads where finding_id = ${dropped.findingId}`);

    expect(await service.readFix(staleFix.fix.id)).toEqual({
      outcome: "unrenderable",
      fixId: staleFix.fix.id,
      findingId: stale.findingId,
    });
    expect(await service.readFix(droppedFix.fix.id)).toEqual({
      outcome: "unrenderable",
      fixId: droppedFix.fix.id,
      findingId: dropped.findingId,
    });

    // The list is right to hide them, and that is exactly why the detail answer must not
    // be not-found: a Slack link to one of these would otherwise say it does not exist.
    expect((await service.listOpen({ projectId: null, limit: 25 })).totalOpen).toBe(0);
  });

  it("keeps another organization's held fix a not_found, not a hold we admit to", async () => {
    const mine = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("read-cross-mine"),
      userName: NAMES.userName("read-cross-mine"),
      email: NAMES.email("read-cross-mine"),
    });
    const theirs = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("read-cross-theirs"),
      userName: NAMES.userName("read-cross-theirs"),
      email: NAMES.email("read-cross-theirs"),
    });

    const seeded = await seedFindingIn(db, theirs, { label: "read-cross-theirs" });
    const opened = await createFixesService(db, theirs.ctx).openFor(seeded.findingId);
    if (opened.outcome !== "opened") throw new Error("expected the press to open a fix");

    await db.execute(
      sql`update finding_payloads set payload_version = ${FIX_SPEC_PAYLOAD_VERSION + 1} where finding_id = ${seeded.findingId}`,
    );

    expect(await createFixesService(db, mine.ctx).readFix(opened.fix.id)).toEqual({
      outcome: "not_found",
    });
  });
});
