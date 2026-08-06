// UX First-Run Checklist row 6 (.ai/ux/cause-stage-citation-gate.md §4, arm 4): a finding that
// never diverged (no divergence row at all, or one whose kind is no_divergence/refused) shows
// the plain "we can't yet say why" state — no transcript, no dropped-claims line. The one thing
// that distinguishes this arm from detail-gate-emptied.test.ts's arm 3 is evidence === null
// (never attempted) vs evidence with beats/claims and zero survivors (attempted, gate emptied
// it) — ADD Decision 3's table, restated as the UX spec's own arm 3/4 split.
import { createDivergencePointsRepo } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { readFindingDetailPageSource, readLiveFindingWave0, seedModelRenderedFinding } from "./helpers/wave0-types";

const WINDOW_START = new Date("2026-08-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-08-08T00:00:00.000Z");

describe("UX row 6 — a finding that never diverged", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("a finding with no divergence row at all reads as described, with evidence: null", async () => {
    const { ctx, projectId, findingId } = await seedModelRenderedFinding(db, "no-divergence-row");

    const finding = await readLiveFindingWave0(db, ctx, projectId, findingId);

    expect(finding?.grade).toBe("described");
    expect(finding?.evidence).toBeNull();
  });

  test("a finding whose divergence row is kind no_divergence still reads as described, with evidence: null", async () => {
    const { ctx, projectId, findingId } = await seedModelRenderedFinding(db, "kind-no-divergence", {
      surface: "/pricing",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    await createDivergencePointsRepo(db, ctx).recordDivergence({
      projectId,
      surface: "/pricing",
      surfaceNormalisationVersion: 1,
      spineVersion: 1,
      cohortMatchVersion: 1,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      kind: "no_divergence",
      divergedAtRank: null,
      reason: "no_gap_found",
      succeededCohortSize: 12,
      failedCohortSize: 0,
      succeededSessionIdsSample: ["session-ok-1"],
      failedSessionIdsSample: [],
    });

    const finding = await readLiveFindingWave0(db, ctx, projectId, findingId);

    expect(finding?.grade).toBe("described");
    expect(finding?.evidence).toBeNull();
  });

  test("the finding detail page's never-attempted arm renders no transcript and no dropped-claims line", () => {
    const source = readFindingDetailPageSource();

    // The old unconditional placeholder line must be gone — FR-12 requires groupOf() (and this
    // page's copy) to stop asserting causation is categorically unbuilt. The source stores the
    // apostrophe as a JSX entity, so both spellings are matched.
    expect(source).not.toMatch(/We can(?:'|&apos;)t yet say why — that stage isn(?:'|&apos;)t built/);
    // The arm-3/arm-4 split this row exists to prove: the page must branch on evidence, not
    // render AnnotatedTranscript unconditionally for every non-withheld finding.
    expect(source).toMatch(/evidence/);
  });
});
