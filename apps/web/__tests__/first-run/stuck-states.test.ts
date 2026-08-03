// B-040: two states rendered no exit control at all. One contradicted itself while
// doing it — a sentence saying there was nothing more to wait for, above a heading
// saying the screen was still reading and a counter that kept climbing.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import {
  ONBOARDING_MESSAGES,
  STAGE_FINDING_UNAVAILABLE,
  STAGE_READING_HEADING,
  STAGE_READING_HINT,
  STAGE_UNREADABLE_HEADING,
  type StagePersistedFacts,
} from "@growthmind/shared";

import { Stage } from "../../components/first-run/Stage";
import { resolvePollCadenceMs } from "../../lib/first-run/poll-cadence";
import { blankComments, readExisting } from "./helpers/first-run-source";
import { readMarkup } from "./helpers/rendered-markup";

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const NOW = ARMED_AT.getTime() + 90_000;

// Armed, reading, and no finding: the shape `findingUnavailable` arrives on.
const READING: StagePersistedFacts = Object.freeze({
  armedAt: ARMED_AT,
  retrievedAt: new Date(ARMED_AT.getTime() + 20_000),
  readingAt: new Date(ARMED_AT.getTime() + 40_000),
  endedAt: null,
  runStatus: "running",
  runOutcome: null,
  finding: null,
});

const stageMarkup = (findingUnavailable: boolean): string =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(Stage, {
        facts: READING,
        nowMs: NOW,
        channelId: null,
        channelLabel: null,
        findingUnavailable,
        delivery: "none" as const,
        deliveryReason: null,
      }),
    ),
  );

const CLIENT = "apps/web/components/first-run/FirstRunClient.tsx";
const clientCode = (): string => blankComments(readExisting(CLIENT).source);

describe("B-040 — a found-but-unrenderable row is a terminal state", () => {
  test("the fault owns the heading, so the screen stops claiming it is still reading", () => {
    const rendered = readMarkup(stageMarkup(true));

    expect(rendered.text).toContain(STAGE_UNREADABLE_HEADING);
    expect(rendered.text).toContain(STAGE_FINDING_UNAVAILABLE);
    expect(rendered.text).not.toContain(STAGE_READING_HEADING);
  });

  test("CONTROL: without the fault the same facts still render the reading heading", () => {
    // Without this row the assertion above would pass against a Stage that never
    // rendered the reading heading at all.
    const rendered = readMarkup(stageMarkup(false));

    expect(rendered.text).toContain(STAGE_READING_HEADING);
    expect(rendered.text).not.toContain(STAGE_UNREADABLE_HEADING);
    expect(rendered.text).not.toContain(STAGE_FINDING_UNAVAILABLE);
  });

  test("the hint that promises a rebuild is not rendered beside a fault that will not clear", () => {
    const rendered = readMarkup(stageMarkup(true));

    expect(rendered.text).not.toContain(STAGE_READING_HINT);
  });

  test("the flag feeds `terminal`, which is what stops the counter and the poll", () => {
    const code = clientCode();

    expect(code).toMatch(
      /const terminal =[\s\S]{0,120}?kind === "ended"[\s\S]{0,40}?\|\|\s*findingUnavailable/,
    );

    // `terminal` is the cadence input, so folding the flag in is what ends the climb.
    expect(code).toMatch(/resolvePollCadenceMs\(\{[\s\S]{0,120}?terminal,/);
    expect(
      resolvePollCadenceMs({ attached: true, armed: true, terminal: true, deliveryState: "none" }),
    ).toBeNull();

    // Control - the same call while NOT terminal still polls, so the row above is
    // not asserting a function that returns null for everything.
    expect(
      resolvePollCadenceMs({ attached: true, armed: true, terminal: false, deliveryState: "none" }),
    ).not.toBeNull();
  });
});

describe("B-040 — a founder who armed and broke nothing can still leave", () => {
  test("the exit row renders whenever armed, not only on the two terminal kinds", () => {
    const code = clientCode();

    // Leg 1 never becomes `ended` on its own: nothing breaks unless the founder
    // breaks it, so gating the row on `terminal` left that screen with no control.
    expect(code).toMatch(/\{armed \? \(\s*<Group/);
    expect(code).not.toMatch(/\{terminal \? \(\s*<Group/);
  });

  test("the two controls inside it stay gated on terminal", () => {
    const code = clientCode();

    // Watch again needs a run that ended, and the Slack link belongs to the closure
    // sentence — neither means anything while the screen is still counting.
    expect(code).toMatch(/\{kind === "ended" \? \(/);
    expect(code).toMatch(/\{terminal && current\.channelId === null \? \(/);
  });

  test("the label says finish setup while waiting, and done once there is nothing left", () => {
    const code = clientCode();

    expect(code).toMatch(
      /terminal \? ONBOARDING_MESSAGES\.done : ONBOARDING_MESSAGES\.finishSetup/,
    );

    // Both are shipped copy, and they are different sentences.
    expect(ONBOARDING_MESSAGES.finishSetup).not.toBe(ONBOARDING_MESSAGES.done);
  });

  test("both labels press the same thing — the exit is one behaviour, not two", () => {
    const code = clientCode();
    const group = code.slice(code.indexOf("{armed ? ("));

    // One `finish()` handler under the row: a second control would be a second way
    // to leave, and only one of them would be tested.
    expect([...group.matchAll(/void finish\(\)/g)]).toHaveLength(1);
  });
});
