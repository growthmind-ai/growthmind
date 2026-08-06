// Wave 5c. Arming replaces the step sequence with the stage, and the assistant
// step does not gate the stage — so a founder could arm with it unfinished and
// never reach the browser mint again, which is the repo-checkout dead end this
// outcome exists to close. There is no Wave 0 row for it: it is a product
// decision taken after the panel shipped.
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  AGENT_CONNECTED_ORG_LINE,
  AGENT_KEY_ONCE_NOTICE,
  AGENT_PICK_PROMPT,
  AGENT_PRE_MINT_LINE,
  AGENT_WAITING_LINE,
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  describeExpectedLag,
  LIVE_STEP_DESCRIPTORS,
  STRIP_REOPEN_LABEL,
  toOnboardingCounterView,
  type AgentConnection,
  type AgentProviderId,
  type EventsSeenCounter,
  type StepId,
} from "@growthmind/shared";

import { AgentPanel } from "../../components/first-run/AgentPanel";
import { FirstRunClient } from "../../components/first-run/FirstRunClient";
import {
  HeldAgentPanelContext,
  type AgentPanelHold,
  type HeldAgentPanel,
} from "../../components/first-run/live-agent";
import type { FirstRunStatusPayload } from "../../lib/first-run/status";
import { blankComments, readExisting } from "./helpers/first-run-source";
import { readMarkup } from "./helpers/rendered-markup";

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

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const sourceOf = (file: string): string => blankComments(readExisting(file).source);

function stepTitle(id: StepId): string {
  const found = LIVE_STEP_DESCRIPTORS.find((descriptor) => descriptor.id === id);
  if (found === undefined) throw new Error(`no live descriptor is declared for ${id}`);
  return found.title;
}

const DONE_GLYPH = "✓";

const MCP_URL = "https://app.example.com/api/mcp";

const ORDER: readonly AgentProviderId[] = ["claude-code", "cursor", "copilot", "codex", "windsurf"];

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");

const COUNTER: EventsSeenCounter = {
  state: { status: "not_connected" },
  totalReceived: 0,
  kept: 0,
  setAside: [],
  keptIdentityUnverified: 0,
  droppedUnreadable: 0,
  asOf: ARMED_AT,
  windowStatement: COUNTER_WINDOW_STATEMENT,
  completenessStatement: COUNTER_COMPLETENESS_STATEMENT,
  expectedLag: describeExpectedLag({ pollIntervalSeconds: 60 }),
};

interface Arrival {
  readonly armed: boolean;
  readonly agent: AgentConnection;
}

const payloadOf = (arrival: Arrival): FirstRunStatusPayload => ({
  finding: null,
  findingId: null,
  findingUnavailable: false,
  findingWithheld: false,
  deliveryState: "none",
  deliveryFailureReason: null,
  armedAt: arrival.armed ? ARMED_AT : null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
  counter: toOnboardingCounterView(COUNTER),
  connectionMessage: "",
  channelId: null,
  channelLabel: null,
  slackSkippedAt: null,
  slackNotice: null,
  slackWorkspaceAttached: false,
  slackWorkspaceName: null,
  slackOAuthAvailable: false,
  providerInterest: [],
  interestPingAvailable: false,
  mcpUrl: MCP_URL,
  agentConnection: arrival.agent,
  agentProviderOrder: ORDER,
});

// The children carry the sequence's OWN panel, exactly as `page.tsx` renders it.
// Both mount points are live in every row below, which is the only arrangement a
// double mount can show up in.
const screen = (arrival: Arrival): string => {
  const status = payloadOf(arrival);

  return render(
    createElement(FirstRunClient, {
      status,
      // oxlint-disable-next-line react/no-children-prop
      children: createElement(AgentPanel, {
        connection: status.agentConnection,
        mcpUrl: status.mcpUrl,
        providerOrder: status.agentProviderOrder,
      }),
    }),
  );
};

const ARMED_WAITING: Arrival = { armed: true, agent: { kind: "waiting" } };
const ARMED_CONNECTED: Arrival = { armed: true, agent: { kind: "connected" } };
const UNARMED_WAITING: Arrival = { armed: false, agent: { kind: "waiting" } };

describe("O-026 — the assistant card survives arming, and only until first contact", () => {
  test("an armed founder whose key has never been called still gets the panel", () => {
    const html = screen(ARMED_WAITING);
    const read = readMarkup(html);

    expect(occurrences(html, AGENT_PICK_PROMPT)).toBe(1);

    expect(read.text).toContain(AGENT_WAITING_LINE);
    expect(read.text).toContain(stepTitle("agent"));
  });

  test("the card is under the strip and outside the summary, where a person can read it", () => {
    const html = screen(ARMED_WAITING);
    const title = stepTitle("agent");

    // `readMarkup` drops every display:none / inert / aria-hidden subtree, and the
    // collapsed summary is one — so reaching the text at all IS the proof the card
    // is not inside it.
    expect(readMarkup(html).text).toContain(title);

    expect(html.indexOf(STRIP_REOPEN_LABEL)).toBeGreaterThan(-1);
    expect(html.indexOf(title)).toBeGreaterThan(html.indexOf(STRIP_REOPEN_LABEL));
    expect(html.indexOf(title)).toBeLessThan(html.indexOf(AGENT_PICK_PROMPT));
  });

  test("first contact takes the card away, and nothing of it is left behind", () => {
    const html = screen(ARMED_CONNECTED);

    expect(occurrences(html, AGENT_PICK_PROMPT)).toBe(0);
    expect(html).not.toContain(AGENT_CONNECTED_ORG_LINE);
    expect(html).not.toContain(AGENT_WAITING_LINE);
    expect(html).not.toContain(DONE_GLYPH);
  });

  test("the collapsed summary stays deferred either way, and the card duplicates no row", () => {
    const waiting = screen(ARMED_WAITING);
    const connected = screen(ARMED_CONNECTED);

    // Mantine's Collapse keeps its children in a hidden `Activity`, so the summary
    // reaches no server markup at all. Every title below is therefore the card's or
    // nobody's — which is what makes the counts a duplication check.
    for (const descriptor of LIVE_STEP_DESCRIPTORS) {
      const own = descriptor.id === "agent";

      expect({
        id: descriptor.id,
        waiting: occurrences(waiting, descriptor.title),
        connected: occurrences(connected, descriptor.title),
      }).toEqual({ id: descriptor.id, waiting: own ? 1 : 0, connected: 0 });
    }
  });

  test("before arming the sequence carries the only panel, and there is no second one", () => {
    const html = screen(UNARMED_WAITING);

    expect(occurrences(html, AGENT_PICK_PROMPT)).toBe(1);

    expect(html).not.toContain(STRIP_REOPEN_LABEL);
    expect(occurrences(html, stepTitle("agent"))).toBe(0);
  });
});

// The assistant step does not gate the stage, so minting at step 3 and arming at
// step 4 is the documented path — and arming unmounts the panel the mint happened
// in. A key shown once cannot be the losing instance's to hold.
describe("O-026 — arming may not destroy a revealed one-time key", () => {
  const RAW_KEY = "gmak_7f3c9a1b4d8e2f06";

  const CLIENT = "apps/web/components/first-run/FirstRunClient.tsx";
  const PANEL = "apps/web/components/first-run/AgentPanel.tsx";

  const panel = (): ReactElement =>
    createElement(AgentPanel, {
      connection: { kind: "none" } as AgentConnection,
      mcpUrl: MCP_URL,
      providerOrder: ORDER,
    });

  const withHold = (hold: AgentPanelHold, ...panels: readonly ReactElement[]): string => {
    const held: HeldAgentPanel = { hold, setHold: () => {} };

    return render(
      createElement(
        HeldAgentPanelContext,
        { value: held },
        ...panels.map((node, index) => createElement("div", { key: index }, node)),
      ),
    );
  };

  test("a panel that minted nothing itself still shows the key the screen is holding", () => {
    const html = withHold({ rawKey: RAW_KEY, provider: "cursor" }, panel());
    const read = readMarkup(html);

    expect(read.text).toContain(AGENT_KEY_ONCE_NOTICE);
    expect(html).toContain(RAW_KEY);
  });

  test("CONTROL: the same panel with nothing held renders choose, so the row above is not vacuous", () => {
    const html = render(panel());

    expect(readMarkup(html).text).toContain(AGENT_PRE_MINT_LINE);
    expect(html).not.toContain(RAW_KEY);
  });

  test("both mount points read the one hold, so the swap hands the key over rather than dropping it", () => {
    const html = withHold({ rawKey: RAW_KEY, provider: "cursor" }, panel(), panel());

    expect(occurrences(html, AGENT_KEY_ONCE_NOTICE)).toBe(2);
    expect(occurrences(html, AGENT_PRE_MINT_LINE)).toBe(0);
  });

  test("the chosen assistant travels with the key, so the block beside it is not another one's", () => {
    const html = withHold({ rawKey: RAW_KEY, provider: "windsurf" }, panel());

    // Windsurf is not first in the order, so a panel that reset to its own default
    // would render Claude Code's CLI line instead of this key's own block.
    expect(html).toContain("serverUrl");
    expect(html).not.toContain("claude mcp add");
  });

  test("the hold is the screen's state and its provider sits above the swap, not inside a branch", () => {
    const code = sourceOf(CLIENT);

    expect(code).toMatch(/const \[hold, setHold\] = useState<AgentPanelHold>\(EMPTY_HOLD\)/);

    const provider = code.indexOf("held={{ hold, setHold }}");
    const swap = code.indexOf("const sequenceGone");

    expect(provider).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(-1);
    expect(code.indexOf("<HeldAgentPanelContext")).toBeGreaterThan(-1);

    // Every branch arming picks between renders inside `Live`, which is where the
    // hold is provided — so no branch can be the key's owner.
    expect(provider).toBeLessThan(code.indexOf("{sequenceGone ? null : ("));
  });

  test("the panel reads the held key rather than owning it", () => {
    const code = sourceOf(PANEL);

    expect(code).toMatch(/const held = useHeldAgentPanel\(\)/);
    expect(code).toMatch(/const hold = held\?\.hold \?\? ownHold/);
    expect(code).toMatch(/const rawKey = hold\.rawKey/);

    // Nothing in the panel may write a raw key into a setter of its own.
    expect(code).not.toMatch(/setRawKey/);
  });
});
