import { describe, expect, test } from "bun:test";

import { describeExpectedLag } from "../../src/counter/lag";
import type { EventsSeenCounter } from "../../src/counter/types";
import {
  CONNECTION_STATE_MESSAGES,
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_LABELS,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
} from "../../src/session-source/messages";
import type { ConnectionState, ConnectionSummary } from "../../src/session-source/types";
import type { CounterRow, OnboardingCounterView } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

const loadToOnboardingCounterView = (): Promise<
  (counter: EventsSeenCounter) => OnboardingCounterView
> =>
  loadUnderConstruction<(counter: EventsSeenCounter) => OnboardingCounterView>({
    modulePath: "../../src/onboarding/counter-view",
    exportName: "toOnboardingCounterView",
    ownedBy: "ADD Wave 1, task 1b.2",
  });

const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;

const EXPECTED_VIEW_KEYS: readonly string[] = [
  "asOfStatement",
  "completenessStatement",
  "identityUnverified",
  "rows",
  "setAside",
  "state",
  "windowStatement",
];

const CONNECTION: ConnectionSummary = {
  id: "conn_0001",
  organizationId: "org_0001",
  projectId: "proj_0001",
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
};

const RECEIVING: ConnectionState = { status: "connected_receiving", connection: CONNECTION };
const NO_EVENTS_YET: ConnectionState = {
  status: "connected_no_events_yet",
  connection: CONNECTION,
};

const REAL_EXPECTED_LAG = describeExpectedLag({ pollIntervalSeconds: 60 });

const COUNTER: EventsSeenCounter = {
  state: RECEIVING,
  totalReceived: 1284,
  kept: 1190,
  setAside: [
    { reason: "internal_domain", count: 80, label: EXCLUSION_REASON_LABELS.internal_domain },
    {
      reason: "automation_known_agent",
      count: 10,
      label: EXCLUSION_REASON_LABELS.automation_known_agent,
    },
  ],
  keptIdentityUnverified: 12,
  droppedUnreadable: 4,
  asOf: new Date("2026-08-01T10:00:00.000Z"),
  windowStatement: COUNTER_WINDOW_STATEMENT,
  completenessStatement: COUNTER_COMPLETENESS_STATEMENT,
  expectedLag: REAL_EXPECTED_LAG,
};

const counterWith = (overrides: Partial<EventsSeenCounter>): EventsSeenCounter => ({
  ...COUNTER,
  ...overrides,
});

const rowFor = (view: OnboardingCounterView, label: string): CounterRow | undefined =>
  view.rows.find((row) => row.label === label);

const deepStrings = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => deepStrings(item));
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.values(value).flatMap((item) => deepStrings(item));
  }
  return [];
};

describe("toOnboardingCounterView — AD-3, FR-O7", () => {
  test("totalReceived equals kept plus every set-aside row plus droppedUnreadable on screen", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    const total = rowFor(view, COUNTER_LABELS.totalReceived);
    const kept = rowFor(view, COUNTER_LABELS.kept);
    const unreadable = rowFor(view, COUNTER_LABELS.droppedUnreadable);

    expect(total).toBeDefined();
    expect(kept).toBeDefined();
    expect(unreadable).toBeDefined();

    const setAsideTotal = view.setAside.reduce((sum, row) => sum + row.value, 0);

    expect(total?.value).toBe((kept?.value ?? 0) + setAsideTotal + (unreadable?.value ?? 0));
  });

  test("keptIdentityUnverified is shown separately from kept", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    expect(view.identityUnverified.value).toBe(COUNTER.keptIdentityUnverified);
    expect(view.identityUnverified.label).toBe(COUNTER_LABELS.keptIdentityUnverified);

    expect(rowFor(view, COUNTER_LABELS.kept)?.value).toBe(COUNTER.kept);
    expect(rowFor(view, COUNTER_LABELS.kept)?.value).not.toBe(
      COUNTER.kept + COUNTER.keptIdentityUnverified,
    );
  });

  test("a null asOf renders that no check has completed, never a blank and never now", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(counterWith({ asOf: null }));

    expect(view.asOfStatement.trim().length).toBeGreaterThan(0);
    expect(view.asOfStatement).not.toMatch(/\bnow\b/i);

    expect(view.asOfStatement).not.toBe(toOnboardingCounterView(COUNTER).asOfStatement);
  });

  test("a zero counter renders the not-yet state, not an error", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(
      counterWith({
        state: NO_EVENTS_YET,
        totalReceived: 0,
        kept: 0,
        setAside: [],
        keptIdentityUnverified: 0,
        droppedUnreadable: 0,
      }),
    );

    for (const row of view.rows) {
      expect(row.value).toBe(0);
    }
    expect(view.identityUnverified.value).toBe(0);

    expect(view.state.status).toBe("connected_no_events_yet");
    expect(CONNECTION_STATE_MESSAGES[view.state.status]).toBeTruthy();
    expect(view.state.status).not.toBe("failing");
  });

  test("an empty setAside array renders a row with zero, not an omitted row", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(counterWith({ setAside: [] }));

    const setAsideRow = rowFor(view, COUNTER_LABELS.setAside);
    expect(setAsideRow).toBeDefined();
    expect(setAsideRow?.value).toBe(0);
  });

  test("the onboarding counter view has no expectedLag key", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    expect(Object.keys(view).toSorted()).toEqual([...EXPECTED_VIEW_KEYS]);

    expect("expectedLag" in view).toBe(false);
  });

  test("no value anywhere in the counter view matches a duration pattern", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    for (const value of deepStrings(view)) {
      expect(value).not.toMatch(DURATION);
      expect(value).not.toMatch(HEDGE);
    }

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(REAL_EXPECTED_LAG.statement);
    expect(serialized).not.toContain(String(REAL_EXPECTED_LAG.typicalSeconds));
    expect(serialized).not.toContain("expectedLag");
  });

  test("every counter label comes from COUNTER_LABELS and every set-aside label from EXCLUSION_REASON_LABELS", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    const counterLabels: readonly string[] = Object.values(COUNTER_LABELS);
    const exclusionLabels: readonly string[] = Object.values(EXCLUSION_REASON_LABELS);

    for (const row of view.rows) {
      expect(counterLabels).toContain(row.label);
    }
    for (const row of view.setAside) {
      expect(exclusionLabels).toContain(row.label);
    }
    expect(counterLabels).toContain(view.identityUnverified.label);

    expect(view.windowStatement).toBe(COUNTER_WINDOW_STATEMENT);
    expect(view.completenessStatement).toBe(COUNTER_COMPLETENESS_STATEMENT);
  });
});
