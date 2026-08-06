// UX First-Run Checklist row 1 (.ai/ux/cause-stage-citation-gate.md §4): a finding that cleared
// the citation gate shows the "explained" grade badge, the causal clause, and a real, focusable
// citation link. Driven through the real read-model (readLiveFinding/groupOf), not a
// hand-assembled FindingDetailView literal — a hand-built object would prove the UI *can*
// render the shape, never that production actually derives it (ADD Decision 8).
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";
import type { BeatView } from "@growthmind/shared";

import { AnnotatedTranscript } from "../../components/findings/AnnotatedTranscript";
import { readMarkup } from "../first-run/helpers/rendered-markup";
import {
  loadCreateCauseClaimsRepo,
  readFindingDetailPageSource,
  readLiveFindingWave0,
  seedModelRenderedFinding,
  type ClaimViewWithHref,
} from "./helpers/wave0-types";

describe("UX row 1 — a finding that cleared the citation gate", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("readLiveFinding grades a finding whose cause stage cleared the citation gate as explained, with a real citation link", async () => {
    const { ctx, projectId, findingId } = await seedModelRenderedFinding(db, "explained");

    const createCauseClaimsRepo = await loadCreateCauseClaimsRepo();
    await createCauseClaimsRepo(db, ctx).persist({
      projectId,
      findingId,
      anchorSessionId: "o44-explained-anchor-session",
      claims: [
        {
          statement: "The field was left blank, so the request never went out.",
          citesBeats: [0],
        },
      ],
      droppedClaims: 0,
      resolvedModelId: "claude-sonnet-5",
      tokensIn: 300,
      tokensOut: 60,
    });

    const finding = await readLiveFindingWave0(db, ctx, projectId, findingId);

    expect(finding?.grade).toBe("explained");
    expect(finding?.evidence?.claims).toHaveLength(1);
    expect(finding?.evidence?.claims[0]?.citesHref).not.toBeNull();
  });

  test("the finding detail page wires AnnotatedTranscript and the grade into the explained arm, not only the withheld placeholder", () => {
    const source = readFindingDetailPageSource();

    // AnnotatedTranscript.tsx has zero callers today (PRD, D11) — this is the flagship wiring
    // gap this outcome exists to close.
    expect(source).toMatch(/AnnotatedTranscript/);
    expect(source).toMatch(/grade/);
  });

  test("a claim with a resolved citesHref renders as a real, focusable control — never click-only text", () => {
    const beats: readonly BeatView[] = [
      { index: 0, at: "01:04", kind: "input", text: "left the email field blank", notable: true, attempt: null },
    ];
    const claims: readonly ClaimViewWithHref[] = [
      {
        statement: "The field was left blank, so the request never went out.",
        citesBeats: [0],
        citesLabel: "from 1:04",
        citesHref: "/replays/o44-explained-recording?t=64000",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(AnnotatedTranscript, {
          beats,
          claims,
          droppedClaims: 0,
        }),
      ),
    );

    const card = readMarkup(html);
    expect(card.controls).toContain("from 1:04");
  });
});
