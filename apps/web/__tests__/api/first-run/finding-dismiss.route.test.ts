import {
  createDismissalsRepo,
  createFindingsRepo,
  sha256Hex,
  type FindingRecord,
} from "@growthmind/db";
import { scannedTextFor, seedAnalysisRun, seedProject } from "@growthmind/db/testing";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  routeRequest,
  tenantOf,
  type FirstRunRouteDeps,
  type FirstRunRouteDescriptor,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "./helpers/first-run-route-contract";

// Declared locally rather than added to FIRST_RUN_ROUTES: registering a route that has no
// route.ts on disk yet would also flip status.route.test.ts's "every route file on disk is
// declared in FIRST_RUN_ROUTES" red, for a reason that test does not own. Mirrors
// settings/slack-channel.route.test.ts's own local `MOVE` descriptor for the same reason.
const FINDING_DISMISS: FirstRunRouteDescriptor = {
  id: "finding-dismiss",
  path: "/api/first-run/finding/dismiss",
  method: "POST",
  modulePath: "apps/web/app/api/first-run/finding/dismiss/route",
  sourcePath: "apps/web/app/api/first-run/finding/dismiss/route.ts",
  declaredKeys: ["findingId"],
  validBody: { findingId: "finding-fixture-id" },
  ownedBy:
    "ADD o-019-dismissal-wired Decision 2 part A " +
    "(apps/web/app/api/first-run/finding/dismiss/route.ts)",
};

const CLOCK = clockAt(new Date("2026-08-06T10:00:00.000Z"));

// 60s: a cold PGlite boot measured ~5.4s and blows bun's 5s default; same figure and
// reasoning as every other first-run route test in this directory.
const COLD_BOOT_BUDGET_MS = 60_000;

let bed: FirstRunTestBed;

beforeAll(async () => {
  bed = await createFirstRunTestBed("finding-dismiss");
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

function depsFor(scope: SeededMemberScope | null): FirstRunRouteDeps {
  return { db: bed.db, tenant: tenantOf(scope?.ctx ?? null), now: CLOCK };
}

const CLEAN_TEXT = scannedTextFor("Two of every three people stop at the payment step", [
  "Of 28 people who reached the payment step, 19 did not finish.",
]);

let seq = 0;

interface FreshFindingOrg {
  readonly owner: SeededMemberScope;
  readonly projectId: string;
  readonly finding: FindingRecord;
}

// One org, one project, one persisted finding — the row the route is supposed to resolve
// findingId against and stamp a dismissal for.
async function freshFindingOrg(label: string): Promise<FreshFindingOrg> {
  seq += 1;
  const token = `${label}-${String(seq)}`;
  const owner = await bed.member(token);
  const project = await seedProject(bed.db, {
    organizationId: owner.organizationId,
    name: `finding-dismiss-${token}`,
  });
  const run = await seedAnalysisRun(bed.db, { ctx: owner.ctx, projectId: project.id });

  const finding = await createFindingsRepo(bed.db, owner.ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature: sha256Hex(`finding-dismiss-route:${token}`),
    signatureVersion: 1,
    summarySource: "model_rendered",
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    detector: "funnel_dropoff",
    finalClass: "funnel_dropoff",
    surface: `/checkout/${token}`,
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "threshold_met",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-08T00:00:00.000Z"),
    evidenceShape: `evidence-${token}`,
    evidenceShapeVersion: 1,
    resolvedModelId: null,
  });

  return { owner, projectId: project.id, finding };
}

async function dismissalRowCount(projectId: string, findingId: string): Promise<number> {
  const result = (await bed.db.execute(
    `select count(*) as n from dismissals where project_id = '${projectId}' and finding_id = '${findingId}'`,
  )) as unknown as { rows?: { n?: unknown }[] } | { n?: unknown }[];
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return Number(rows[0]?.n ?? 0);
}

// The route module (apps/web/app/api/first-run/finding/dismiss/route.ts) does not exist on
// this tree yet — loadRouteHandler's dynamic import fails to resolve, and every test below
// fails at that line. That is the correct Wave 0 red: the surface ADD Decision 2 part A
// commits to is entirely absent, not merely misbehaving.
describe("POST /api/first-run/finding/dismiss — FR-6/FR-7 (ADD o-019-dismissal-wired Decision 2)", () => {
  test("records a dismissal for the caller's org, keyed on the supplied findingId", async () => {
    const handle = await loadRouteHandler(FINDING_DISMISS);
    const org = await freshFindingOrg("record");

    const response = await handle(
      routeRequest(FINDING_DISMISS, { findingId: org.finding.id }),
      depsFor(org.owner),
    );

    expect(response.status).toBe(200);

    const row = await createDismissalsRepo(bed.db, org.owner.ctx).findFor(
      org.finding.id,
      "not_useful",
    );
    expect(row?.projectId).toBe(org.projectId);
    expect(row?.findingId).toBe(org.finding.id);
    expect(row?.signature).toBe(org.finding.signature);
    expect(row?.action).toBe("not_useful");
    expect(row?.dismissedByUserId).toBe(org.owner.userId);
  });

  test("rejects a findingId belonging to another organization with a 4xx, never a 5xx, and creates no row", async () => {
    const handle = await loadRouteHandler(FINDING_DISMISS);
    const orgA = await freshFindingOrg("xt-a");
    const orgB = await freshFindingOrg("xt-b");

    const response = await handle(
      routeRequest(FINDING_DISMISS, { findingId: orgA.finding.id }),
      depsFor(orgB.owner),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    const row = await createDismissalsRepo(bed.db, orgA.owner.ctx).findFor(
      orgA.finding.id,
      "not_useful",
    );
    expect(row).toBeNull();
  });

  test("invoked twice for the same findingId results in exactly one dismissals row and 200 both times", async () => {
    const handle = await loadRouteHandler(FINDING_DISMISS);
    const org = await freshFindingOrg("dup");

    const first = await handle(
      routeRequest(FINDING_DISMISS, { findingId: org.finding.id }),
      depsFor(org.owner),
    );
    const second = await handle(
      routeRequest(FINDING_DISMISS, { findingId: org.finding.id }),
      depsFor(org.owner),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(await dismissalRowCount(org.projectId, org.finding.id)).toBe(1);
  });
});
