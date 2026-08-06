// o-019-dismissal-wired, Wave 0. FindingCard's dismiss control does not exist on this
// tree yet (ADD Decision 2/"FindingCard Affordance" in .ai/ux/o-019-dismissal-wired.md
// §2) — every markup assertion below drives the future prop shape, and every claim
// about a click's downstream effect is a source scan rather than a simulated
// interaction: this repo has no DOM renderer (see agent-panel.test.ts's own header
// comment, and CompanyListBody.test.tsx's), so the codebase's own established pattern
// for an async click-then-rerender flow is render-per-state markup plus a scan proving
// the wiring exists, not a fired event.
import { randomUUID } from "node:crypto";

import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import {
  createFindingsRepo,
  createFirstRunStatusService,
  createSignatureLedgerService,
  signatureHex,
  type MeasuredCountRow,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedAnalysisRun,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
  makeTenantContext,
} from "@growthmind/db/testing";
import type { OnboardingFinding } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { FindingCard } from "../../components/first-run/FindingCard";
import { buildFirstRunStatus } from "../../lib/first-run/status";
import { blankComments, FINDING_CARD, readFirstRun } from "./helpers/first-run-source";
import { readMarkup } from "./helpers/rendered-markup";

const render = (node: ReactElement): string =>
  renderToStaticMarkup(createElement(MantineProvider, null, node));

const FINDING: OnboardingFinding = {
  finalClass: "something_is_not_working",
  headline: "Saving your workspace settings is not working.",
  context: ["Three people hit this in the last hour."],
  counts: [{ numerator: 3, denominator: 3, unit: "sessions" }],
  surface: "/settings",
  confidenceBasis: "above_floor",
  windowStart: new Date("2026-08-01T09:55:00.000Z"),
  windowEnd: new Date("2026-08-01T10:07:00.000Z"),
  summarySource: "model_rendered",
};

type DismissOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

// ADD .ai/ux/o-019-dismissal-wired.md §2's "Component contract" — not yet declared on
// FindingCardProps, so this file drives the future prop shape rather than today's,
// per test-requirements.md's Wave 0 placeholder-type allowance.
interface FindingCardPropsWithDismiss {
  readonly finding: OnboardingFinding;
  readonly arriving: boolean;
  readonly onDismiss?: () => Promise<DismissOutcome>;
}

function cardMarkup(overrides: Partial<FindingCardPropsWithDismiss> = {}): string {
  const props: FindingCardPropsWithDismiss = { finding: FINDING, arriving: false, ...overrides };
  return render(createElement(FindingCard, props as ComponentProps<typeof FindingCard>));
}

describe("first-run FindingCard dismiss control", () => {
  test("founder can dismiss a finding from the first-run FindingCard and see it confirmed without a reload", () => {
    const idle = readMarkup(cardMarkup({ onDismiss: () => Promise.resolve({ ok: true }) }));

    // Idle render, with a real onDismiss wired: the control has to exist before
    // there is anything to press.
    expect(idle.controls).toContain("Not useful");

    // The confirmed transition itself cannot be driven from here — no DOM renderer
    // in this repo — so the source is the proof that a successful onDismiss() call
    // renders the confirmed line, per the shipped copy (.ai/ux/o-019-dismissal-wired.md §2).
    const code = blankComments(readFirstRun(FINDING_CARD).source);
    expect(code).toContain("onDismiss");
    expect(code).toContain("Dismissed. Nobody on this team will see it again.");
  });

  test("founder sees the error state and an unchanged card on a network failure, and can retry with the same button", () => {
    const code = blankComments(readFirstRun(FINDING_CARD).source);

    expect(code).toContain("That didn't go through — this finding is still here.");

    // The UX spec's own edge-case row: a failed press re-enables the SAME button
    // rather than adding a second "Retry" control, so the idle label must appear
    // exactly once in the source.
    expect((code.match(/Not useful/g) ?? []).length).toBe(1);
    expect(code).not.toContain("Retry");
  });

  test("dismiss control does not render when onDismiss is not wired, rather than rendering inert", () => {
    const unwired = readMarkup(cardMarkup());
    expect(unwired.controls).not.toContain("Not useful");

    // Control — without it, a component that never renders the button at all
    // (wired or not) would satisfy the row above for the wrong reason (D11: an
    // unwired button must not exist, not render as a dead click target).
    const wired = readMarkup(cardMarkup({ onDismiss: () => Promise.resolve({ ok: true }) }));
    expect(wired.controls).toContain("Not useful");
  });

  test("keyboard-only activation of the dismiss control succeeds and announces the confirmed state via the existing role='status' region", () => {
    const card = readMarkup(cardMarkup({ onDismiss: () => Promise.resolve({ ok: true }) }));

    // `readMarkup` only records a genuine <button>/<a>/<summary> as a control — a
    // `<div onClick>` would land its label in `.text` instead. Being picked up here
    // IS the proof it is a native, keyboard-operable button (UX spec Interaction
    // Patterns: "nothing bespoke is required").
    expect(card.controls).toContain("Not useful");

    const code = blankComments(readFirstRun(FINDING_CARD).source);
    const statusRegions = code.match(/role=["']status["']/g) ?? [];

    // The confirmed line has to be announced by the region this card already has —
    // a second, nested role="status" is a double-announcement bug, not a safety
    // margin (UX spec Interaction Patterns).
    expect(statusRegions).toHaveLength(1);
  });
});

const MEASURED_COUNT: MeasuredCountRow = {
  numerator: 3,
  denominator: 10,
  unit: "sessions",
  timeframe: {
    start: new Date("2026-07-30T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  },
  basis: { totalInWindow: 10, kept: 10, setAside: [], keptUnchecked: 0 },
};

test("a teammate who never touched Slack loads the first-run screen after a dismissal and sees no stale FindingCard", async () => {
  const { db, close } = await createTestDb();

  try {
    const org = await seedOrgWithOwner(db, {
      orgName: "o19-dismiss-org",
      userName: "o19-dismiss-founder",
      email: `o19-dismiss-founder-${randomUUID()}@example.com`,
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "o19-dismiss-project",
    });

    const teammate = await seedUser(db, {
      name: "o19-dismiss-teammate",
      email: `o19-dismiss-teammate-${randomUUID()}@example.com`,
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx = makeTenantContext({
      userId: teammate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    const run = await seedAnalysisRun(db, { ctx: org.ctx, projectId: project.id });
    const signature = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const text = scannedTextFor("Checkout drops after the address step", [
      "One line of context, never a blob.",
    ]);

    const finding = await createFindingsRepo(db, org.ctx).persist({
      projectId: project.id,
      runId: run.id,
      signature,
      signatureVersion: 1,
      summarySource: "model_rendered",
      headline: text.headline,
      context: text.context,
      detector: "observed_struggle",
      finalClass: "confusing",
      surface: "/checkout",
      surfaceNormalisationVersion: 1,
      counts: [MEASURED_COUNT],
      confidenceBasis: "few_sessions",
      windowStart: new Date("2026-07-30T00:00:00.000Z"),
      windowEnd: new Date("2026-08-01T00:00:00.000Z"),
      evidenceShape: "o19-dismiss-evidence-v1",
      evidenceShapeVersion: 1,
      resolvedModelId: "o19-fixture-model",
    });

    // Recorded from the founder's context — the axis under test is the READ, below,
    // happening through a second, never-touched-Slack member's own context.
    await createSignatureLedgerService(db, org.ctx).recordDismissal({
      projectId: project.id,
      findingId: finding.id,
      signature: signatureHex(signature),
      action: "not_useful",
      dismissedByUserId: org.userId,
    });

    const facts = await createFirstRunStatusService(db, teammateCtx).read(project.id);
    const payload = await buildFirstRunStatus({
      db,
      ctx: teammateCtx,
      projectId: project.id,
      facts,
    });

    expect(payload.finding).toBeNull();
  } finally {
    await close();
  }
});
