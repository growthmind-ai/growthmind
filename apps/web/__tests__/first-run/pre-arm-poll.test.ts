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

import {
  ARMED_POLL_MS,
  DELIVERY_WATCH_POLL_MS,
  PRE_ARM_POLL_MS,
  resolvePollCadenceMs,
} from "../../lib/first-run/poll-cadence";
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
  findingUnavailable: false,
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
  slackSkippedAt: null,
  slackNotice: null,
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
  providerInterest: [],
  interestPingAvailable: false,
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

function pollEffect(code: string): string {
  const interval = code.indexOf("setInterval(");
  const start = code.lastIndexOf("useEffect(", interval);
  const end = code.indexOf("]);", interval);

  if (interval === -1 || start === -1 || end === -1) {
    throw new Error(
      `${CLIENT} no longer holds a setInterval inside a useEffect, so the poll effect cannot be read`,
    );
  }

  return code.slice(start, end + 3);
}

// Terminal and deliveryState are REQUIRED properties: a call site that forgets to say
// what it knows is a compile error rather than a branch nobody wired.
const WATCHING = { terminal: false, deliveryState: "none" } as const;

describe("resolvePollCadenceMs", () => {
  test("the pre-arm cadence is slower than the armed cadence", () => {
    expect(PRE_ARM_POLL_MS).toBeGreaterThan(ARMED_POLL_MS);

    expect(resolvePollCadenceMs({ ...WATCHING, attached: true, armed: false })).toBe(
      PRE_ARM_POLL_MS,
    );
    expect(resolvePollCadenceMs({ ...WATCHING, attached: true, armed: true })).toBe(ARMED_POLL_MS);
  });

  test("a client with no connection creates no interval and issues no fetch", () => {
    expect(resolvePollCadenceMs({ ...WATCHING, attached: false, armed: false })).toBeNull();

    expect(resolvePollCadenceMs({ ...WATCHING, attached: false, armed: true })).toBe(ARMED_POLL_MS);
  });

  test("a terminal stage whose delivery is unposted keeps polling, so the line can flip", () => {
    expect(
      resolvePollCadenceMs({
        attached: true,
        armed: true,
        terminal: true,
        deliveryState: "unposted",
      }),
    ).toBe(DELIVERY_WATCH_POLL_MS);

    expect(
      resolvePollCadenceMs({
        attached: false,
        armed: true,
        terminal: true,
        deliveryState: "unposted",
      }),
    ).toBe(DELIVERY_WATCH_POLL_MS);
  });

  test("a terminal stage with nothing left to watch stops, and only then", () => {
    for (const deliveryState of ["none", "posted", "failed"] as const) {
      expect(
        resolvePollCadenceMs({ attached: true, armed: true, terminal: true, deliveryState }),
      ).toBeNull();
    }
  });

  test("a finding on a project nobody armed keeps the setup cadence, findings and all", () => {
    for (const deliveryState of ["none", "unposted", "posted", "failed"] as const) {
      expect(
        resolvePollCadenceMs({ attached: true, armed: false, terminal: true, deliveryState }),
      ).toBe(PRE_ARM_POLL_MS);
    }

    expect(
      resolvePollCadenceMs({
        attached: false,
        armed: false,
        terminal: true,
        deliveryState: "unposted",
      }),
    ).toBeNull();
  });
});

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

describe("the wire into the client (D11)", () => {
  test("exactly one interval exists whether armed or unarmed", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(occurrences(code, "setInterval(")).toBe(1);
    expect(code.match(/useRef<ReturnType<typeof setInterval>/g)?.length).toBe(1);

    expect(code).toMatch(/\}, cadenceMs\);/);
    expect(code).not.toMatch(/\}, \d[\d_]*\);/);
  });

  test("the poll effect asks resolvePollCadenceMs and nothing else", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toMatch(
      /import\s*\{[^}]*resolvePollCadenceMs[^}]*\}\s*from\s*"@\/lib\/first-run\/poll-cadence"/,
    );

    const effect = pollEffect(code);

    expect(effect).not.toMatch(/\barmed\b/);
    expect(effect).toContain("cadenceMs");

    // `terminal` joins `armed` on the far side of the resolver. Asked here as well, the
    // effect tore the interval down while the delivery line still said "not posted".
    expect(effect).not.toMatch(/\bterminal\b/);

    const asked = code.indexOf("resolvePollCadenceMs({");
    const call = code.slice(asked, code.indexOf("});", asked));

    const unasked = ["attached", "armed", "terminal", "deliveryState"].filter(
      (fact) => !new RegExp(`\\b${fact}\\b`).test(call),
    );
    expect(unasked).toEqual([]);
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

  test("a failed pre-arm fetch keeps the counter and leaves the interval running", () => {
    const effect = pollEffect(blankComments(readExisting(CLIENT).source));

    const callback = effect.slice(effect.indexOf("setInterval("), effect.indexOf("}, cadenceMs);"));

    expect(callback).toContain("setLost(next === null)");

    // The failure path writes no state the counter is rendered from...
    expect(occurrences(callback, "setPolled(")).toBe(1);
    expect(callback).toMatch(/if\s*\(next\s*!==\s*null\)\s*\{\s*setPolled\(next\);/);

    // ...and tears nothing down, so the next tick still happens.
    expect(callback).not.toContain("clearInterval");
    expect(callback).not.toContain("clearTimeout");
  });

  test("the client renders the resolver's sentence, never the armed one directly", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toContain("resolveOfflineNotice");
    expect(code).not.toContain("ONBOARDING_MESSAGES.offlineNotice");
    expect(code).not.toContain("STAGE_OFFLINE_NOTICE");
  });
});
