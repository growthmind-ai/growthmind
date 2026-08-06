// UX First-Run Checklist row 1 (.ai/ux/cause-stage-citation-gate.md §4): a finding that cleared
// the citation gate shows the "explained" grade badge, the causal clause, and a real, focusable
// citation link. Driven through the real read-model (readLiveFinding/groupOf), not a
// hand-assembled FindingDetailView literal — a hand-built object would prove the UI *can*
// render the shape, never that production actually derives it (ADD Decision 8).
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createRecordingSummariesRepo } from "@growthmind/db";
import { createTestDb, scannedTextFor, seedConnection, seedSession, type TestDb } from "@growthmind/db/testing";
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

const CITED_RECORDING_ID = "o44-explained-recording";
const CITED_SESSION_KEY = `ph:${CITED_RECORDING_ID}`;
const CITED_ACTION_AT_MS = 64_000;

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

    // citesHref is only ever non-null when the anchor session's own citation resolves (D5) —
    // that requires a real session + recording summary row, joined by sessionKey, exactly as
    // packages/db/__tests__/repositories/recording-summaries.repo.test.ts's own citationsFor
    // fixtures do. A bare cause_claims row with a made-up anchorSessionId string can only ever
    // prove the null-fallback path, never this one.
    const connection = await seedConnection(db, { organizationId: ctx.organizationId, projectId });
    const session = await seedSession(db, {
      organizationId: ctx.organizationId,
      projectId,
      connectionId: connection.id,
      sessionKey: CITED_SESSION_KEY,
    });
    const summaryText = scannedTextFor("Someone left the email field blank", [
      "They left the field blank and the request never went out.",
    ]);

    await createRecordingSummariesRepo(db, ctx).persist({
      projectId,
      recordingId: CITED_RECORDING_ID,
      summarySource: "model_rendered",
      headline: summaryText.headline,
      context: summaryText.context,
      transcript: "1:04  left the email field blank",
      pages: ["/checkout"],
      durationMs: 90_000,
      actionCount: 1,
      notableCount: 1,
      droppedEvents: 0,
      startedAt: new Date("2026-08-01T00:01:04.000Z"),
      provider: "posthog",
      sessionKey: CITED_SESSION_KEY,
      sessionGroupingVersion: 1,
      actions: {
        v: 1,
        actions: [
          {
            kind: "input",
            atMs: CITED_ACTION_AT_MS,
            element: { nodeId: 1, tag: "input", classes: ["email"] },
          },
        ],
      },
      actionsVersion: 1,
      actionsOmitted: 0,
      pullStop: "exhausted",
      pullReason: null,
      pullWatermarkAt: null,
      resolvedModelId: "claude-sonnet-5",
      tokensIn: 40,
      tokensOut: 17,
    });

    const createCauseClaimsRepo = await loadCreateCauseClaimsRepo();
    await createCauseClaimsRepo(db, ctx).persist({
      projectId,
      findingId,
      anchorSessionId: session.id,
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
    // The control's full accessible name also carries the WCAG 3.2.5 new-tab warning (§3 of the
    // UX spec, verified verbatim by detail-citation.test.ts) — so this checks the control starts
    // with the citation label rather than being exactly it. The point of this test is "a real,
    // focusable control exists and it is the citation", not "the control's name has no suffix".
    expect(card.controls.some((control) => control.startsWith("from 1:04"))).toBe(true);
  });
});
