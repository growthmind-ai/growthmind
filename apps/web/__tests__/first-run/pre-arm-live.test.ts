import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  describeExpectedLag,
  EXCLUSION_REASON_LABELS,
  STAGE_OFFLINE_NOTICE,
  STAGE_OFFLINE_SETUP_NOTICE,
  toOnboardingCounterView,
  type ConnectionState,
  type EventsSeenCounter,
  type OnboardingCounterView,
  type SetupFacts,
} from "@growthmind/shared";

import { resolveOfflineNotice } from "../../lib/first-run/offline-notice";
import type { FirstRunStatusPayload } from "../../lib/first-run/status";

import { CounterGrid } from "../../components/first-run/CounterGrid";
import { FirstRunClient } from "../../components/first-run/FirstRunClient";
import { SetupStage } from "../../components/first-run/SetupStage";

import { blankComments, readExisting } from "./helpers/first-run-source";

const CLIENT = "apps/web/components/first-run/FirstRunClient.tsx";

const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

const render = (node: ReactElement): string =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AppRouterContext.Provider, { value: FAKE_ROUTER }, node),
    ),
  );

const RECEIVING: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "conn_pre_arm",
    organizationId: "org_pre_arm",
    projectId: "proj_pre_arm",
    sourceKind: "posthog",
    host: "https://us.i.posthog.com",
    sourceProjectId: "12345",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: new Date("2026-08-01T10:00:00.000Z"),
    watermarkAt: new Date("2026-08-01T10:00:00.000Z"),
    backfillBefore: null,
    pollIntervalSeconds: 60,
    connectedAt: new Date("2026-08-01T09:50:00.000Z"),
    inferredInternalDomain: "example.com",
    internalDomainProvenance: "org_creator_email",
  },
};

const counterOf = (totalReceived: number, kept: number, asOf: Date): EventsSeenCounter => ({
  state: RECEIVING,
  totalReceived,
  kept,
  setAside: [
    { reason: "internal_domain", count: 0, label: EXCLUSION_REASON_LABELS.internal_domain },
  ],
  keptIdentityUnverified: 0,
  droppedUnreadable: 0,
  asOf,
  windowStatement: COUNTER_WINDOW_STATEMENT,
  completenessStatement: COUNTER_COMPLETENESS_STATEMENT,
  expectedLag: describeExpectedLag({ pollIntervalSeconds: 60 }),
});

const EARLIER = new Date("2026-08-01T10:00:00.000Z");
const LATER = new Date("2026-08-01T10:05:00.000Z");

const STALE_VIEW = toOnboardingCounterView(counterOf(1234, 1200, EARLIER));
const LIVE_VIEW = toOnboardingCounterView(counterOf(5678, 5600, LATER));

const QUIET_BEFORE = toOnboardingCounterView(counterOf(0, 0, EARLIER));
const QUIET_AFTER = toOnboardingCounterView(counterOf(0, 0, LATER));

const unarmedPayload = (counter: OnboardingCounterView): FirstRunStatusPayload => ({
  finding: null,
  findingId: null,
  findingUnavailable: false,
  findingWithheld: false,
  deliveryState: "none",
  deliveryFailureReason: null,
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
  counter,
  connectionMessage: "",
  channelId: "C01AB2CD3EF",
  channelLabel: "growth",
  slackSkippedAt: null,
  slackNotice: null,
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
  providerInterest: [],
  interestPingAvailable: false,
  mcpUrl: "https://app.example.com/api/mcp",
  agentConnection: { kind: "none" },
  agentProviderOrder: [],
});

const READY_TO_ARM: SetupFacts = {
  analyticsAttached: true,
  workspaceAttached: true,
  deliveryResolved: true,
  armedAt: null,
};

const clientMarkup = (live: OnboardingCounterView, serverRendered: OnboardingCounterView): string =>
  render(
    createElement(FirstRunClient, {
      status: unarmedPayload(live),
      // oxlint-disable-next-line react/no-children-prop
      children: createElement(CounterGrid, { view: serverRendered }),
    }),
  );

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

function clockEffect(code: string): string {
  const interval = code.indexOf("setInterval(");
  const start = code.lastIndexOf("useEffect(", interval);
  const end = code.indexOf("]);", interval);

  if (interval === -1 || start === -1 || end === -1) {
    throw new Error(
      `${CLIENT} no longer holds a setInterval inside a useEffect, so the display clock cannot be read`,
    );
  }

  return code.slice(start, end + 3);
}

describe("the counter the founder is watching", () => {
  test("a connected unarmed client polls status and the rendered counter changes", () => {
    const markup = clientMarkup(LIVE_VIEW, STALE_VIEW);

    expect(markup).toContain("5678");
    expect(markup).not.toContain("1234");

    const quiet = clientMarkup(QUIET_AFTER, QUIET_BEFORE);

    expect(quiet).toContain(QUIET_AFTER.asOfStatement);
    expect(quiet).not.toContain(QUIET_BEFORE.asOfStatement);
  });

  test("the server-rendered counter is the fallback, not a zero", () => {
    const markup = render(createElement(CounterGrid, { view: STALE_VIEW }));

    expect(markup).toContain("1234");
    expect(markup).toContain("1200");
    expect(markup).toContain(STALE_VIEW.asOfStatement);
  });

  test("the counter inside the server subtree agrees with the one in the setup stage", () => {
    const markup = clientMarkup(LIVE_VIEW, STALE_VIEW);

    expect(occurrences(markup, "5678")).toBeGreaterThanOrEqual(2);
    expect(occurrences(markup, "1234")).toBe(0);
  });

  test("the pre-arm counter update is not announced by an assertive live region", () => {
    const markup = render(
      createElement(SetupStage, {
        facts: READY_TO_ARM,
        counter: LIVE_VIEW,
        attached: true,
        pending: false,
        onArm: () => {},
      }),
    );

    expect(markup).not.toContain('aria-live="assertive"');
    expect(markup).toContain('aria-live="off"');
    expect(markup).toContain("5678");
  });
});

describe("the screen is told, never asks (D11)", () => {
  test("nothing in the client fetches the status route any more", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).not.toContain("FIRST_RUN_API.status");
    expect(code).not.toContain("pollStatus");
  });

  test("it listens on every topic that writes a fact it renders", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toContain("LiveRefresh");

    // The counter and the stage come from a worker run, the finding from the analysis lane,
    // and first contact from the assistant's own call. Missing any one of the three is a
    // screen that sits still while the fact behind it moved.
    for (const topic of ["first_run", "findings", "agent_connection"]) {
      expect(code).toContain(`"${topic}"`);
    }
  });

  test("the one interval left advances the rendered elapsed time and reads nothing", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(occurrences(code, "setInterval(")).toBe(1);

    const effect = clockEffect(code);

    expect(effect).toContain("setNowMs(Date.now())");
    expect(effect).not.toContain("fetch(");
    expect(effect).not.toContain("setOverlay");
  });

  test("the clock stops once nothing is counting, so a settled screen holds no timer", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toMatch(/const ticking = armed && !terminal;/);
    expect(clockEffect(code)).toMatch(/if\s*\(!ticking\)/);
  });
});

describe("the pre-arm poll degrades cleanly — FR-GL14", () => {
  test("a lost connection before arming claims nothing about a check", () => {
    const preArm = resolveOfflineNotice({ lost: true, armed: false, terminal: false });

    expect(preArm).toBe(STAGE_OFFLINE_SETUP_NOTICE);
    expect(preArm).not.toBe(STAGE_OFFLINE_NOTICE);

    expect(STAGE_OFFLINE_NOTICE).toContain("check");
    expect(preArm).not.toContain("check");
    expect(preArm).not.toContain("elapsed");
  });

  test("the sentence that names a running check renders only while one is running", () => {
    expect(resolveOfflineNotice({ lost: true, armed: true, terminal: false })).toBe(
      STAGE_OFFLINE_NOTICE,
    );

    expect(resolveOfflineNotice({ lost: true, armed: true, terminal: true })).toBe(
      STAGE_OFFLINE_SETUP_NOTICE,
    );

    for (const armed of [true, false]) {
      for (const terminal of [true, false]) {
        expect(resolveOfflineNotice({ lost: false, armed, terminal })).toBeNull();
      }
    }
  });

  test("a dropped change feed is what now claims the screen may be behind", () => {
    const code = blankComments(readExisting(CLIENT).source);

    // The notice used to be driven by a failed poll. Its input is the stream's own
    // connection state now, or the sentence would never render again.
    expect(code).toMatch(/onConnection=\{setConnected\}/);
    expect(code).toMatch(/lost:\s*!connected/);
  });

  test("the client renders the resolver's sentence, never the armed one directly", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toContain("resolveOfflineNotice");
    expect(code).not.toContain("ONBOARDING_MESSAGES.offlineNotice");
    expect(code).not.toContain("STAGE_OFFLINE_NOTICE");
  });
});
