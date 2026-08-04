// B-040: two states rendered no exit control at all, and one contradicted itself.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import {
  ONBOARDING_MESSAGES,
  STAGE_FINDING_UNAVAILABLE,
  STAGE_READING_HEADING,
  STAGE_NO_DELIVERY_LINE,
  STAGE_READING_HINT,
  STAGE_UNREADABLE_HEADING,
  type StagePersistedFacts,
} from "@growthmind/shared";

import { Stage } from "../../components/first-run/Stage";
import {
  agentStillWatched,
  ARMED_POLL_MS,
  PRE_ARM_POLL_MS,
  resolvePollCadenceMs,
} from "../../lib/first-run/poll-cadence";
import { blankComments, readExisting } from "./helpers/first-run-source";
import { readMarkup } from "./helpers/rendered-markup";

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const NOW = ARMED_AT.getTime() + 90_000;

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

const AGENT_PANEL_FILE = "apps/web/components/first-run/AgentPanel.tsx";
const ANALYTICS_FORM_FILE = "apps/web/components/first-run/ConnectAnalyticsForm.tsx";

describe("B-040 — a found-but-unrenderable row is a terminal state", () => {
  test("the fault owns the heading, so the screen stops claiming it is still reading", () => {
    const rendered = readMarkup(stageMarkup(true));

    expect(rendered.text).toContain(STAGE_UNREADABLE_HEADING);
    expect(rendered.text).toContain(STAGE_FINDING_UNAVAILABLE);
    expect(rendered.text).not.toContain(STAGE_READING_HEADING);
  });

  test("CONTROL: without the fault the same facts still render the reading heading", () => {
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

    expect(code).toMatch(/resolvePollCadenceMs\(\{[\s\S]{0,160}?terminal,/);
    expect(
      resolvePollCadenceMs({
        attached: true,
        armed: true,
        terminal: true,
        deliveryState: "none",
        agentWaiting: false,
      }),
    ).toBeNull();

    // Control - not-terminal still polls, so the row above is not vacuous.
    expect(
      resolvePollCadenceMs({
        attached: true,
        armed: true,
        terminal: false,
        deliveryState: "none",
        agentWaiting: false,
      }),
    ).not.toBeNull();
  });
});

describe("O-026 — a key that has never been called is still being watched", () => {
  test("a founder waiting for first contact keeps polling with nothing else left to watch", () => {
    // Every other dimension says stop: unarmed, unattached, terminal, delivered.
    const settled = {
      attached: false,
      armed: false,
      terminal: true,
      deliveryState: "none",
    } as const;

    expect(resolvePollCadenceMs({ ...settled, agentWaiting: false })).toBeNull();
    expect(resolvePollCadenceMs({ ...settled, agentWaiting: true })).toBe(PRE_ARM_POLL_MS);
  });

  test("waiting never slows a lane that was already polling faster", () => {
    expect(
      resolvePollCadenceMs({
        attached: true,
        armed: true,
        terminal: false,
        deliveryState: "none",
        agentWaiting: true,
      }),
    ).toBe(ARMED_POLL_MS);
  });

  test("the client passes the agent dimension rather than defaulting it", () => {
    expect(clientCode()).toMatch(/resolvePollCadenceMs\(\{[\s\S]{0,200}?agentWaiting/);
  });
});

describe("O-026 — the founder who just minted is watched, not deadlocked", () => {
  // The payload that rendered the page was served when the org had no key at all,
  // so `{ kind: "none" }` is the connection every fresh mint is pressed against.
  const UNAWARE = { kind: "none" } as const;

  test("a key minted in this tab is in flight, even though the payload predates it", () => {
    expect(agentStillWatched({ connection: UNAWARE, heldKey: null })).toBe(false);
    expect(agentStillWatched({ connection: UNAWARE, heldKey: "gmak_7f3c9a1b" })).toBe(true);
  });

  test("first contact ends the watch rather than extending it for as long as the key is held", () => {
    expect(agentStillWatched({ connection: { kind: "waiting" }, heldKey: null })).toBe(true);
    expect(agentStillWatched({ connection: { kind: "connected" }, heldKey: "gmak_7f3c9a1b" })).toBe(
      false,
    );
  });

  test("the two settled screens a founder mints from start polling once a key is held", () => {
    // Unarmed with nothing connected, and armed at a terminal stage with delivery
    // settled: both resolve to `null` while the payload is the only thing asked.
    const unarmed = {
      attached: false,
      armed: false,
      terminal: true,
      deliveryState: "none",
    } as const;
    const settled = {
      attached: true,
      armed: true,
      terminal: true,
      deliveryState: "posted",
    } as const;

    for (const screen of [unarmed, settled]) {
      const beforeMint = agentStillWatched({ connection: UNAWARE, heldKey: null });
      const afterMint = agentStillWatched({ connection: UNAWARE, heldKey: "gmak_7f3c9a1b" });

      expect(resolvePollCadenceMs({ ...screen, agentWaiting: beforeMint })).toBeNull();
      expect(resolvePollCadenceMs({ ...screen, agentWaiting: afterMint })).toBe(PRE_ARM_POLL_MS);
    }
  });

  test("the client derives the dimension from the key it holds, not from the payload alone", () => {
    const code = clientCode();

    expect(code).toMatch(/agentStillWatched\(\{[\s\S]{0,120}?heldKey:\s*hold\.rawKey/);
    expect(code).toMatch(/const agentWaiting = agentStillWatched\(/);

    // The hold is the client's own state, so the mint that fills it re-renders the
    // component that owns the cadence — no callback to sever (D11).
    expect(code).toMatch(/useState<AgentPanelHold>\(EMPTY_HOLD\)/);
    expect(code).toMatch(/held=\{\{ hold, setHold \}\}/);
  });

  test("the panel asks the screen to re-read itself on both writes, the way the analytics card does", () => {
    const panel = blankComments(readExisting(AGENT_PANEL_FILE).source);
    const analytics = blankComments(readExisting(ANALYTICS_FORM_FILE).source);

    expect(analytics).toMatch(/router\.refresh\(\)/);
    expect([...panel.matchAll(/router\.refresh\(\)/g)]).toHaveLength(2);

    expect(panel).toMatch(
      /setHold\(\{ rawKey: key, provider \}\);[\s\S]{0,400}?router\.refresh\(\)/,
    );
  });
});

describe("B-040 — a founder who armed and broke nothing can still leave", () => {
  test("the exit row renders whenever armed, not only on the two terminal kinds", () => {
    const code = clientCode();

    // Leg 1 never becomes `ended` on its own, so gating on `terminal` stranded it.
    expect(code).toMatch(/\{armed \? \(\s*<Group/);
    expect(code).not.toMatch(/\{terminal \? \(\s*<Group/);
  });

  test("the two controls inside it stay gated on terminal", () => {
    const code = clientCode();

    // Neither means anything while the screen is still counting.
    expect(code).toMatch(/\{kind === "ended" \? \(/);
    expect(code).toMatch(/\{terminal && current\.channelId === null \? \(/);
  });

  test("the label says finish setup while waiting, and done once there is nothing left", () => {
    const code = clientCode();

    expect(code).toMatch(
      /terminal \? ONBOARDING_MESSAGES\.done : ONBOARDING_MESSAGES\.finishSetup/,
    );

    expect(ONBOARDING_MESSAGES.finishSetup).not.toBe(ONBOARDING_MESSAGES.done);
  });

  test("both labels press the same thing — the exit is one behaviour, not two", () => {
    const code = clientCode();
    const group = code.slice(code.indexOf("{armed ? ("));

    // One handler: a second control would be a second way to leave.
    expect([...group.matchAll(/void finish\(\)/g)]).toHaveLength(1);
  });
});

describe("B-042 — the fault state says where the finding went, and the exit says what it costs", () => {
  const CHANNEL = "C01AB2CD3EF";

  const withChannel = (channelId: string | null, channelLabel: string | null): string =>
    renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(Stage, {
          facts: READING,
          nowMs: NOW,
          channelId,
          channelLabel,
          findingUnavailable: true,
          delivery: "none" as const,
          deliveryReason: null,
        }),
      ),
    );

  test("a connected channel is named, so the state has a next action", () => {
    const rendered = readMarkup(withChannel(CHANNEL, "growth"));

    expect(rendered.text).toContain("#growth");
    expect(rendered.text).not.toContain(STAGE_NO_DELIVERY_LINE);
  });

  test("no channel says nowhere rather than naming one", () => {
    // `renderDeliveryClosure` cannot serve this state: the row correlates no delivery,
    // so `delivery` is always "none" and it would answer "nowhere" for a real channel.
    const rendered = readMarkup(withChannel(CHANNEL, null));
    expect(rendered.text).toContain(`#${CHANNEL}`);

    for (const absent of [null, "", "null"]) {
      expect(readMarkup(withChannel(absent, null)).text).toContain(STAGE_NO_DELIVERY_LINE);
    }
  });

  test("the closure only renders for the fault, never beside a healthy wait", () => {
    const healthy = readMarkup(
      renderToStaticMarkup(
        createElement(
          MantineProvider,
          null,
          createElement(Stage, {
            facts: READING,
            nowMs: NOW,
            channelId: CHANNEL,
            channelLabel: "growth",
            findingUnavailable: false,
            delivery: "none" as const,
            deliveryReason: null,
          }),
        ),
      ),
    );

    expect(healthy.text).not.toContain("#growth");
    expect(healthy.text).not.toContain(STAGE_NO_DELIVERY_LINE);
  });

  test("the exit warns what it costs while still waiting, and is not the dominant control", () => {
    const code = clientCode();

    // Dismissal has no undo route anywhere, and the warning already existed — it
    // rendered only under the finding, after the payoff, where it matters least.
    expect(code).toMatch(/\{armed && !terminal \? \([\s\S]{0,200}?STAGE_RETIRE_CLOSURE/);
    expect(code).toMatch(/variant=\{terminal \? "filled" : "default"\}/);
  });
});
