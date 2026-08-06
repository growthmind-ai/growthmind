// Shared Wave 0 stand-ins for O-044 (ADD tasks/o-044-cause-stage-citation-gate/add.md, Decision
// 8) — used by detail-explained.test.ts, detail-citation.test.ts, detail-gate-emptied.test.ts,
// detail-never-attempted.test.ts, all of which drive the SAME not-yet-built read-model shape.
//
// `readLiveFinding` and `ClaimView` already exist today, but without the `grade`/`evidence`
// field (read.ts) and `citesHref` field (view.ts) this sprint adds. Casting through a local
// stand-in — rather than importing the real (narrower) type and accessing a field TypeScript
// doesn't know about — is what keeps these test files typechecking cleanly per the Wave 0
// contract: the assertions fail at runtime (the field is genuinely absent from the object the
// real function returns today), never at compile time.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFindingsRepo, type ScopedDb } from "@growthmind/db";
import {
  scannedTextFor,
  seedAnalysisRun,
  seedOrgWithOwner,
  seedProject,
  type TestDb,
} from "@growthmind/db/testing";
import { summarySourceSchema, type BeatView, type ClaimView, type TenantContext } from "@growthmind/shared";

import { readLiveFinding as readLiveFindingReal } from "../../../lib/findings/read";
import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

export const CAUSE_CLAIMS_REPO_OWNER =
  "backend-execution-agent, Wave 3 (packages/db/src/repositories/cause-claims.repo.ts, ADD Decision 3)";

export const EVIDENCE_READ_PATH_OWNER =
  "frontend-execution-agent, Wave 6/7 (apps/web/lib/findings/read.ts + evidence.ts + " +
  "app/(app)/findings/[id]/page.tsx, ADD Decision 8)";

// ClaimView + citesHref (view.ts's one new field, ADD Decision 8 / UX spec §1).
export interface ClaimViewWithHref extends ClaimView {
  readonly citesHref: string | null;
}

export interface FindingDetailViewWave0 {
  readonly id: string;
  readonly headline: string;
  readonly context: string;
  readonly countLine: string;
  readonly coverageLine: string;
  readonly withheld: boolean;

  readonly grade: "explained" | "described";
  readonly evidence: {
    readonly beats: readonly BeatView[];
    readonly claims: readonly ClaimViewWithHref[];
    readonly droppedClaims: number;
  } | null;
}

export type ReadLiveFindingWave0 = (
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
  id: string,
) => Promise<FindingDetailViewWave0 | null>;

// The real function, today returning a narrower object with no `grade`/`evidence` — accessing
// those fields on the cast result is `undefined`, which is the honest Wave 0 red.
export const readLiveFindingWave0 = readLiveFindingReal as unknown as ReadLiveFindingWave0;

export interface CauseClaimStatement {
  readonly statement: string;
  readonly citesBeats: readonly number[];
}

export interface PersistCauseClaimsInputWave0 {
  readonly projectId: string;
  readonly findingId: string;
  readonly anchorSessionId: string;
  readonly claims: readonly CauseClaimStatement[];
  readonly droppedClaims: number;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface CauseClaimsRecordWave0 extends PersistCauseClaimsInputWave0 {
  readonly id: string;
  readonly organizationId: string;
  readonly createdAt: Date;
}

export interface CauseClaimsRepoWave0 {
  persist(input: PersistCauseClaimsInputWave0): Promise<CauseClaimsRecordWave0>;
  findForFinding(projectId: string, findingId: string): Promise<CauseClaimsRecordWave0 | null>;
}

export type CreateCauseClaimsRepoWave0 = (db: ScopedDb, ctx: TenantContext) => CauseClaimsRepoWave0;

// Mirrors worker/__tests__/analysis/cause.test.ts's own loadPlanCause() forward-import exactly:
// this module does not exist on the tree yet (Wave 3), and this is the consumer-side proof of
// that same absence — a red for the right reason, not a broken import.
export const loadCreateCauseClaimsRepo = (): Promise<CreateCauseClaimsRepoWave0> =>
  loadUnderConstruction<CreateCauseClaimsRepoWave0>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/cause-claims.repo.ts"),
    exportName: "createCauseClaimsRepo",
    ownedBy: CAUSE_CLAIMS_REPO_OWNER,
  });

export const FINDING_DETAIL_PAGE_RELATIVE_PATH = "apps/web/app/(app)/findings/[id]/page.tsx";

export function readFindingDetailPageSource(): string {
  return readFileSync(path.join(REPO_ROOT, FINDING_DETAIL_PAGE_RELATIVE_PATH), "utf8");
}

export const ANNOTATED_TRANSCRIPT_RELATIVE_PATH = "apps/web/components/findings/AnnotatedTranscript.tsx";

export function readAnnotatedTranscriptSource(): string {
  return readFileSync(path.join(REPO_ROOT, ANNOTATED_TRANSCRIPT_RELATIVE_PATH), "utf8");
}

// The exact jargon list the UX spec (§4 row 5) and PRD (P-2 job) name as forbidden in a
// dropped-claims line a non-technical reader must be able to understand honestly.
export const INTERNAL_JARGON_TERMS: readonly string[] = ["citation gate", "signature", "claim schema"];

export function jargonFoundIn(text: string): readonly string[] {
  const lower = text.toLowerCase();
  return INTERNAL_JARGON_TERMS.filter((term) => lower.includes(term));
}

const DEFAULT_WINDOW_START = new Date("2026-08-01T00:00:00.000Z");
const DEFAULT_WINDOW_END = new Date("2026-08-08T00:00:00.000Z");

export interface SeededFindingWorkspace {
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly findingId: string;
}

// A plain model_rendered finding — real DB row, real repo, exactly the fixture read.test.ts
// already uses. Every 0.9-0.12 test starts from one of these; what differs between them is
// what (if anything) gets layered on top (a cause_claims row, a divergence row, neither).
export async function seedModelRenderedFinding(
  db: TestDb,
  label: string,
  overrides: { readonly windowStart?: Date; readonly windowEnd?: Date; readonly surface?: string } = {},
): Promise<SeededFindingWorkspace> {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-cause-detail-${label}`,
    userName: `Owner ${label}`,
    email: `owner-cause-detail-${label}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `project-cause-detail-${label}`,
  });
  const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });
  const text = scannedTextFor("The checkout step is losing sessions", [
    "Of 28 people who reached checkout, 19 did not finish.",
  ]);

  const finding = await createFindingsRepo(db, org.ctx).persist({
    projectId: project.id,
    runId: run.id,
    signature: `sig-cause-detail-${label}`,
    signatureVersion: 1,
    detector: "funnel_dropoff",
    summarySource: summarySourceSchema.enum.model_rendered,
    headline: text.headline,
    context: text.context,
    finalClass: "funnel_dropoff",
    surface: overrides.surface ?? "/checkout",
    surfaceNormalisationVersion: 1,
    counts: [],
    confidenceBasis: "28 kept sessions in a seven-day window",
    windowStart: overrides.windowStart ?? DEFAULT_WINDOW_START,
    windowEnd: overrides.windowEnd ?? DEFAULT_WINDOW_END,
    evidenceShape: "funnel_dropoff:step=checkout",
    evidenceShapeVersion: 1,
    resolvedModelId: "claude-sonnet-5",
    tokensIn: 900,
    tokensOut: 120,
  });

  return { ctx: org.ctx, projectId: project.id, findingId: finding.id };
}
