// THE COUNTER VIEW — AD-3, FR-O7. ADD §9, 8 rows.
//
// AD-3 IN ONE SENTENCE: `EventsSeenCounter.expectedLag` is not deleted, it is
// made STRUCTURALLY UNRENDERABLE by an explicitly-enumerated narrowing view, so
// that rendering a duration promise is a COMPILE ERROR rather than a discipline.
//
// Why that matters concretely, and it is not hypothetical: `describeExpectedLag`
// computes `pollIntervalSeconds + 25` and `pollIntervalSeconds + 220`. With the
// shipped column default of 60 that is the sentence "85 seconds… 280 seconds",
// rendered in front of a customer, failing FR-O18 and FR-O22 in one line. This
// suite builds its fixture with THE REAL `describeExpectedLag` so that sentence
// is genuinely present on the input, and then proves it is nowhere on the
// output. A fixture with a hand-written stub lag would prove nothing.
//
// THE TYPE IS WRITTEN BY EXPLICIT FIELD ENUMERATION, NEVER
// `Omit<EventsSeenCounter, "expectedLag">`. An `Omit` silently re-admits the
// NEXT duration-bearing field somebody adds to the shipped counter; an
// enumeration refuses it by default. Row 6 is what makes that structural
// instead of advisory — see the note there for the mechanism by which an `Omit`
// fails it.

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

/** ADD Wave 1 (task 1b.2) creates this. */
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

/** The exact seven fields AD-3 enumerates (ADD lines 137-145), written in
 *  sorted order so the comparison below needs no sort on this side. */
const EXPECTED_VIEW_KEYS: readonly string[] = [
  "asOfStatement",
  "completenessStatement",
  "identityUnverified",
  "rows",
  "setAside",
  "state",
  "windowStatement",
];

// --- fixtures --------------------------------------------------------------

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

/**
 * THE REAL duration promise, on the input. With a 60 s poll interval this
 * statement names 85 and 280 seconds — precisely what AD-3 exists to keep off
 * the screen.
 */
const REAL_EXPECTED_LAG = describeExpectedLag({ pollIntervalSeconds: 60 });

/** 1190 + 80 + 10 + 4 = 1284. The identity holds on the source, so a failure of
 *  row 1 is a failure of the VIEW rather than of the fixture's arithmetic. */
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

/** Every string value anywhere in the view, however deeply nested. */
const deepStrings = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => deepStrings(item));
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.values(value).flatMap((item) => deepStrings(item));
  }
  return [];
};

describe("toOnboardingCounterView — AD-3, FR-O7", () => {
  // Row 1
  test("totalReceived equals kept plus every set-aside row plus droppedUnreadable on screen", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    // THE IDENTITY IS READ OFF THE VIEW, NOT OFF THE SOURCE. A founder checking
    // our arithmetic checks the numbers ON SCREEN — an identity that only holds
    // on the object behind them is an identity nobody can see.
    const total = rowFor(view, COUNTER_LABELS.totalReceived);
    const kept = rowFor(view, COUNTER_LABELS.kept);
    const unreadable = rowFor(view, COUNTER_LABELS.droppedUnreadable);

    expect(total).toBeDefined();
    expect(kept).toBeDefined();
    expect(unreadable).toBeDefined();

    const setAsideTotal = view.setAside.reduce((sum, row) => sum + row.value, 0);

    expect(total?.value).toBe((kept?.value ?? 0) + setAsideTotal + (unreadable?.value ?? 0));
  });

  // Row 2 — UX Checklist row 10.
  test("keptIdentityUnverified is shown separately from kept", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    // Its OWN CounterRow, structurally separate from `rows` — a session we
    // could not check is not a session we checked and cleared, and this field
    // is what keeps that difference on screen.
    expect(view.identityUnverified.value).toBe(COUNTER.keptIdentityUnverified);
    expect(view.identityUnverified.label).toBe(COUNTER_LABELS.keptIdentityUnverified);

    // And `kept` is rendered UNCHANGED — never summed with the unverified count,
    // which would launder "we could not check who they were" into "counted as
    // real people".
    expect(rowFor(view, COUNTER_LABELS.kept)?.value).toBe(COUNTER.kept);
    expect(rowFor(view, COUNTER_LABELS.kept)?.value).not.toBe(
      COUNTER.kept + COUNTER.keptIdentityUnverified,
    );
  });

  // Row 3
  test("a null asOf renders that no check has completed, never a blank and never now", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(counterWith({ asOf: null }));

    expect(view.asOfStatement.trim().length).toBeGreaterThan(0);
    expect(view.asOfStatement).not.toMatch(/\bnow\b/i);

    // And it says something DIFFERENT from the populated case — "we have not
    // completed a check yet" is a fact, not a formatting of nothing.
    expect(view.asOfStatement).not.toBe(toOnboardingCounterView(COUNTER).asOfStatement);
  });

  // Row 4
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

    // Every number on screen is zero — and that is a REAL, REPORTABLE ANSWER:
    // we looked and found nothing, which is not the same as an error and not
    // the same as a blank.
    for (const row of view.rows) {
      expect(row.value).toBe(0);
    }
    expect(view.identityUnverified.value).toBe(0);

    // The state is the polled-and-empty one, and its shipped sentence is
    // reachable from the view without the component authoring a second copy.
    expect(view.state.status).toBe("connected_no_events_yet");
    expect(CONNECTION_STATE_MESSAGES[view.state.status]).toBeTruthy();
    expect(view.state.status).not.toBe("failing");
  });

  // Row 5 — UX Checklist row 9's empty case.
  test("an empty setAside array renders a row with zero, not an omitted row", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(counterWith({ setAside: [] }));

    // The aggregate "Set aside" row still renders, carrying 0. An omitted row
    // reads as "this does not apply to you"; a zero reads as "we checked, and
    // it was none" — and only one of those is true.
    const setAsideRow = rowFor(view, COUNTER_LABELS.setAside);
    expect(setAsideRow).toBeDefined();
    expect(setAsideRow?.value).toBe(0);
  });

  // Row 6 — AD-3's structural guard.
  test("the onboarding counter view has no expectedLag key", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    // EXACT ENUMERATION, and this is what catches an `Omit`. An
    // `Omit<EventsSeenCounter, "expectedLag">` would carry `totalReceived`,
    // `kept`, `keptIdentityUnverified`, `droppedUnreadable` and `asOf` as raw
    // fields — a key set that cannot equal the seven AD-3 enumerates. So the
    // implementation cannot satisfy this row by reaching for `Omit` and cannot
    // silently re-admit the next duration-bearing field either.
    expect(Object.keys(view).toSorted()).toEqual([...EXPECTED_VIEW_KEYS]);

    // NOT A BANNED ROW: §9's "no key enumeration alone" rule governs a ZOD
    // SCHEMA'S REFUSAL of an unknown INPUT key, where `Object.keys(shape)`
    // cannot tell `z.object` from `z.strictObject`. This is a claim about an
    // OUTPUT OBJECT'S OWN KEYS, where enumeration IS the behaviour. The
    // behavioural half is row 7 below, which proves the VALUE is gone too.
    expect("expectedLag" in view).toBe(false);
  });

  // Row 7
  test("no value anywhere in the counter view matches a duration pattern", async () => {
    const toOnboardingCounterView = await loadToOnboardingCounterView();

    const view = toOnboardingCounterView(COUNTER);

    for (const value of deepStrings(view)) {
      expect(value).not.toMatch(DURATION);
      expect(value).not.toMatch(HEDGE);
    }

    // And specifically: the real "85 seconds… 280 seconds" sentence that was on
    // the input is nowhere on the output, at any depth. This is the behavioural
    // half of row 6 — the key being absent is worth nothing if the value came
    // through under another name.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(REAL_EXPECTED_LAG.statement);
    expect(serialized).not.toContain(String(REAL_EXPECTED_LAG.typicalSeconds));
    expect(serialized).not.toContain("expectedLag");
  });

  // Row 8 — B3, one home for copy.
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

    // The two statements are the shipped constants verbatim, not re-authored.
    expect(view.windowStatement).toBe(COUNTER_WINDOW_STATEMENT);
    expect(view.completenessStatement).toBe(COUNTER_COMPLETENESS_STATEMENT);
  });
});
