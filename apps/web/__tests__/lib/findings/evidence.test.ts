import type { PersistedSessionAction } from "@growthmind/core";
import {
  createFindingsRepo,
  type FindingRecord,
  type SessionRecordingCitation,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  type TestDb,
} from "@growthmind/db/testing";
import { summarySourceSchema, type BeatView, type ClaimView } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";

// Wave 0 contract shape (ADD tasks/o-044-cause-stage-citation-gate/add.md, Decision 8; task
// 6.2 in tasks.xml). apps/web/lib/findings/evidence.ts and its production dependencies
// (packages/core/src/replay/beats.ts) don't exist yet — Wave 2/6. Every symbol below is a
// stand-in that mirrors the ADD's own stated shape, exactly as worker/__tests__/analysis/
// cause.test.ts already does for planCause.
const EVIDENCE_BUILDER_OWNER =
  "frontend-execution-agent, Wave 6 (apps/web/lib/findings/evidence.ts, ADD Decision 8)";

interface CauseClaimStatement {
  readonly statement: string;
  readonly citesBeats: readonly number[];
}

// Mirrors the worker test's CauseClaimRecord stand-in field-for-field (anchorSessionId,
// claims, droppedClaims) so both halves of this sprint's contract describe the same row shape.
interface CauseClaimsRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly findingId: string;
  readonly anchorSessionId: string;
  readonly claims: readonly CauseClaimStatement[];
  readonly droppedClaims: number;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly createdAt: Date;
}

type CitationsForFn = (
  projectId: string,
  sessionIds: readonly string[],
) => Promise<readonly SessionRecordingCitation[]>;

// ClaimView + citesHref (view.ts's one new field, ADD Decision 8 / UX spec §1) — not on the
// real ClaimView yet, so a local stand-in keeps this file typechecking against today's tree.
interface ClaimViewWithHref extends ClaimView {
  readonly citesHref: string | null;
}

// The FindingDetailView.evidence shape the ADD names exactly (Decision 8) — the builder's
// return value is this subset, not the fuller packages/shared EvidenceView.
interface EvidenceBuildResult {
  readonly beats: readonly BeatView[];
  readonly claims: readonly ClaimViewWithHref[];
  readonly droppedClaims: number;
}

type BuildEvidenceView = (
  finding: FindingRecord,
  causeClaims: CauseClaimsRecord | null,
  citationsFor: CitationsForFn,
) => Promise<EvidenceBuildResult | null>;

const loadBuildEvidenceView = (): Promise<BuildEvidenceView> =>
  loadUnderConstruction<BuildEvidenceView>({
    modulePath: underConstructionSpecifier("apps/web/lib/findings/evidence.ts"),
    exportName: "buildEvidenceView",
    ownedBy: EVIDENCE_BUILDER_OWNER,
  });

// ---------------------------------------------------------------------------------------------

const WINDOW_START = new Date("2026-08-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-08-08T00:00:00.000Z");
const ANCHOR_SESSION_ID = "o44-evidence-anchor-session";

const CLEAN_TEXT = scannedTextFor("The checkout step is losing sessions", [
  "Of 28 people who reached checkout, 19 did not finish.",
]);

function readableCitation(
  overrides: Partial<SessionRecordingCitation> = {},
): SessionRecordingCitation {
  return {
    sessionId: ANCHOR_SESSION_ID,
    recordingId: "o44-evidence-recording",
    provider: "posthog",
    transcriptVersion: 1,
    actions: [
      { kind: "click", atMs: 100, element: { nodeId: 1, tag: "button", classes: ["submit"] } },
      {
        kind: "field_abandoned",
        atMs: 400,
        element: { nodeId: 2, tag: "input", classes: ["email"] },
      },
    ] satisfies readonly PersistedSessionAction[],
    omitted: 0,
    pullStop: null,
    pullReason: null,
    ...overrides,
  };
}

function causeClaimsRecord(
  finding: FindingRecord,
  overrides: Partial<CauseClaimsRecord> = {},
): CauseClaimsRecord {
  return {
    id: "o44-evidence-cause-claim",
    organizationId: finding.organizationId,
    projectId: finding.projectId,
    findingId: finding.id,
    anchorSessionId: ANCHOR_SESSION_ID,
    claims: [
      { statement: "The field was left blank, so the request never went out.", citesBeats: [0] },
    ],
    droppedClaims: 0,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 300,
    tokensOut: 60,
    createdAt: WINDOW_END,
    ...overrides,
  };
}

function citationsForReturning(
  citations: readonly SessionRecordingCitation[],
  calls: string[][],
): CitationsForFn {
  return (_projectId: string, sessionIds: readonly string[]) => {
    calls.push([...sessionIds]);
    return Promise.resolve(citations);
  };
}

function citationsForNeverCalled(): CitationsForFn {
  return () => {
    throw new Error("buildEvidenceView must never call citationsFor when causeClaims is null");
  };
}

async function seedFinding(db: TestDb, label: string): Promise<FindingRecord> {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-evidence-${label}`,
    userName: `Owner ${label}`,
    email: `owner-evidence-${label}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `project-evidence-${label}`,
  });
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });

  return createFindingsRepo(db, org.ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature: `sig-evidence-${label}`,
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: CLEAN_TEXT.headline,
    context: CLEAN_TEXT.context,
    finalClass: "funnel_dropoff",
    surface: "/checkout",
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    evidenceShape: "funnel_dropoff:step=checkout",
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 900,
    tokensOut: 120,
  });
}

describe("apps/web/lib/findings/evidence.ts buildEvidenceView", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("builds BeatView[]/ClaimView[] from a survivor-claims fixture with a non-null citesHref per claim", async () => {
    const buildEvidenceView = await loadBuildEvidenceView();
    const finding = await seedFinding(db, "survivors");
    const claims = causeClaimsRecord(finding);
    const calls: string[][] = [];

    const result = await buildEvidenceView(
      finding,
      claims,
      citationsForReturning([readableCitation()], calls),
    );

    expect(calls).toEqual([[ANCHOR_SESSION_ID]]);
    expect(result).not.toBeNull();
    expect(result?.beats.length).toBeGreaterThan(0);
    expect(result?.claims).toHaveLength(1);
    expect(result?.claims[0]?.citesHref).toBe("/replays/o44-evidence-recording?t=100");
    expect(result?.droppedClaims).toBe(0);
  });

  test("degrades citesHref to null, never an unreachable URL, when the anchor session's citation is unresolvable", async () => {
    const buildEvidenceView = await loadBuildEvidenceView();
    const finding = await seedFinding(db, "withheld");
    const claims = causeClaimsRecord(finding);
    const calls: string[][] = [];

    // The mask floor withheld the recording since this row was written: citationsFor now
    // returns nothing for the anchor session id, exactly as it does for any session with no
    // persisted recording summary.
    const result = await buildEvidenceView(finding, claims, citationsForReturning([], calls));

    expect(result).not.toBeNull();
    for (const claim of result?.claims ?? []) {
      expect(claim.citesHref).toBeNull();
    }
  });

  test("returns evidence: null without ever calling citationsFor when causeClaims is null", async () => {
    const buildEvidenceView = await loadBuildEvidenceView();
    const finding = await seedFinding(db, "never-attempted");

    const result = await buildEvidenceView(finding, null, citationsForNeverCalled());

    expect(result).toBeNull();
  });
});
