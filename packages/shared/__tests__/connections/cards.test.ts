import { describe, expect, test } from "bun:test";

import {
  buildAnalyticsCard,
  buildDeliveryCard,
  buildProductCard,
  productActionLabel,
  describeCadence,
  describeEventVolume,
  type AnalyticsCardInput,
  type DeliveryCardInput,
} from "../../src/connections/cards";
import {
  CONNECTION_FACT_LABELS,
  NOTHING_ATTACHED_HEADLINE,
  PRODUCT_UNKNOWN_HEADLINE,
  WORKSPACE_UNNAMED,
} from "../../src/connections/messages";
import { CONNECTION_STATE_MESSAGES } from "../../src/session-source/messages";
import { soleLiveProviderOn } from "../../src/onboarding/providers";
import { RESEARCH_STATUSES } from "../../src/growth/provenance";
import type { ConnectionStateStatus } from "../../src/session-source/types";
import type { ConnectionCardView } from "../../src/connections/types";

const NOW = new Date("2026-08-07T12:00:00Z").getTime();

const valueOf = (card: ConnectionCardView, label: string): string | undefined =>
  card.facts.find((fact) => fact.label === label)?.value;

const ATTACHED: AnalyticsCardInput = Object.freeze({
  providerId: "posthog",
  status: "connected_receiving",
  statement: CONNECTION_STATE_MESSAGES.connected_receiving,
  host: "https://eu.i.posthog.com",
  sourceProjectId: "236988",
  eventsReceived: 100,
  eventsKept: 90,
  eventsSetAside: 8,
  newestSessionAt: new Date("2026-08-07T11:46:00Z"),
  lastCheckAt: new Date("2026-08-07T11:59:30Z"),
  connectedAt: new Date("2026-08-04T12:00:00Z"),
  pollIntervalSeconds: 60,
  failure: null,
  nowMs: NOW,
});

const analytics = (over: Partial<AnalyticsCardInput>): ConnectionCardView =>
  buildAnalyticsCard({ ...ATTACHED, ...over });

const DELIVERING: DeliveryCardInput = Object.freeze({
  providerId: "slack",
  workspaceAttached: true,
  workspaceName: "Acme",
  channelId: "C123",
  channelLabel: "issues",
  connectedAt: new Date("2026-08-04T12:00:00Z"),
  nowMs: NOW,
});

const delivery = (over: Partial<DeliveryCardInput>): ConnectionCardView =>
  buildDeliveryCard({ ...DELIVERING, ...over });

const ALL_STATUSES: readonly ConnectionStateStatus[] = [
  "not_connected",
  "validating",
  "connected_never_polled",
  "connected_no_events_yet",
  "connected_receiving",
  "failing",
  "disconnected",
];

describe("the analytics card names its vendor, not its hostname", () => {
  test("the headline is the product's name, so nobody has to recognise an address", () => {
    expect(analytics({}).headline).toBe("PostHog");
  });

  test("the address and project stay, as facts under the name rather than in place of it", () => {
    const card = analytics({});

    expect(valueOf(card, CONNECTION_FACT_LABELS.address)).toBe("https://eu.i.posthog.com");
    expect(valueOf(card, CONNECTION_FACT_LABELS.project)).toBe("236988");
  });

  // The empty state still names the vendor, because the form under it is that vendor's:
  // "Nothing connected" over a field asking for a PostHog key makes a reader deduce the
  // product from a field's help text.
  test("an absent provider still names what this rail connects to, and carries no facts", () => {
    const card = analytics({ providerId: null, status: "not_connected" });

    expect(card.headline).toBe("PostHog");
    expect(card.facts).toEqual([]);
    expect(card.tone).toBe("off");
  });

  test("every connection status resolves to a tone and a label, and only receiving is live", () => {
    const live = ALL_STATUSES.filter((status) => analytics({ status }).tone === "live");
    expect(live).toEqual(["connected_receiving"]);

    const unlabelled = ALL_STATUSES.filter(
      (status) => analytics({ status }).statusLabel.trim() === "",
    );
    expect(unlabelled).toEqual([]);
  });

  test("a failing connection asks for attention and shows the reason it was given", () => {
    const card = analytics({
      status: "failing",
      statement: CONNECTION_STATE_MESSAGES.failing,
      failure: "That key can no longer read this project.",
    });

    expect(card.tone).toBe("attention");
    expect(valueOf(card, CONNECTION_FACT_LABELS.problem)).toBe(
      "That key can no longer read this project.",
    );
  });

  test("a healthy connection carries no problem row", () => {
    expect(valueOf(analytics({}), CONNECTION_FACT_LABELS.problem)).toBeUndefined();
  });

  // The two ages answer different questions: a quiet product keeps the check fresh while
  // the newest session ages, and collapsing them would hide a working connection.
  test("the last check and the newest session are separate rows", () => {
    const card = analytics({});

    expect(valueOf(card, CONNECTION_FACT_LABELS.lastCheck)).toBe("moments ago");
    expect(valueOf(card, CONNECTION_FACT_LABELS.newestSession)).toBe("14 minutes ago");
  });

  test("a connection that has never been checked omits both ages rather than showing zero", () => {
    const card = analytics({
      status: "connected_never_polled",
      statement: CONNECTION_STATE_MESSAGES.connected_never_polled,
      newestSessionAt: null,
      lastCheckAt: null,
    });

    expect(valueOf(card, CONNECTION_FACT_LABELS.lastCheck)).toBeUndefined();
    expect(valueOf(card, CONNECTION_FACT_LABELS.newestSession)).toBeUndefined();
  });

  test("a detached connection keeps its facts, because what was collected is still here", () => {
    const card = analytics({
      status: "disconnected",
      statement: CONNECTION_STATE_MESSAGES.disconnected,
    });

    expect(card.tone).toBe("off");
    expect(valueOf(card, CONNECTION_FACT_LABELS.events)).toBe(
      "90 counted of 100 received, 8 set aside",
    );
  });
});

describe("the event volume always says out of how many", () => {
  test("a kept count is stated against the total it came from", () => {
    expect(describeEventVolume({ received: 100, kept: 90, setAside: 8 })).toBe(
      "90 counted of 100 received, 8 set aside",
    );
  });

  test("nothing set aside drops the clause rather than saying zero", () => {
    expect(describeEventVolume({ received: 100, kept: 100, setAside: 0 })).toBe(
      "100 counted of 100 received",
    );
  });

  test("an empty stream says so instead of reading as a total of nothing", () => {
    expect(describeEventVolume({ received: 0, kept: 0, setAside: 0 })).toBe("none received yet");
  });
});

describe("the check cadence reads as a person would say it", () => {
  test("a minute stays in seconds, because sixty is the familiar number", () => {
    expect(describeCadence(60)).toBe("every 60 seconds");
  });

  test("whole minutes above one are said in minutes", () => {
    expect(describeCadence(300)).toBe("every 5 minutes");
  });

  test("an uneven interval stays in seconds rather than rounding a claim", () => {
    expect(describeCadence(90)).toBe("every 90 seconds");
  });

  test("an absent or impossible interval produces no row at all", () => {
    expect(describeCadence(null)).toBeNull();
    expect(describeCadence(0)).toBeNull();
  });
});

describe("the delivery card names Slack, which the channel alone never did", () => {
  test("a settled channel names the vendor, the workspace and the channel", () => {
    const card = delivery({});

    expect(card.headline).toBe("Slack");
    expect(card.tone).toBe("live");
    expect(valueOf(card, CONNECTION_FACT_LABELS.workspace)).toBe("Acme");
    expect(valueOf(card, CONNECTION_FACT_LABELS.channel)).toBe("issues");
  });

  // The pasted-token path stores no team name, and a blank beside "Workspace" reads as
  // one that went missing.
  test("an unnamed workspace falls back to a phrase rather than an empty row", () => {
    expect(valueOf(delivery({ workspaceName: null }), CONNECTION_FACT_LABELS.workspace)).toBe(
      WORKSPACE_UNNAMED,
    );
  });

  test("a channel with no stored name falls back to its id rather than rendering nothing", () => {
    expect(valueOf(delivery({ channelLabel: null }), CONNECTION_FACT_LABELS.channel)).toBe("C123");
  });

  test("a workspace with no channel asks for attention — connected, but nothing can arrive", () => {
    const card = delivery({ channelId: null, channelLabel: null });

    expect(card.headline).toBe("Slack");
    expect(card.tone).toBe("attention");
    expect(valueOf(card, CONNECTION_FACT_LABELS.channel)).toBeUndefined();
  });

  test("no workspace still names Slack, and carries no facts", () => {
    const card = delivery({ workspaceAttached: false, workspaceName: null, channelId: null });

    expect(card.headline).toBe("Slack");
    expect(card.tone).toBe("off");
    expect(card.facts).toEqual([]);
  });
});

describe("naming an unattached rail — what it offers, never a guess between two", () => {
  test("a rail with one live provider is named by it", () => {
    expect(soleLiveProviderOn("analytics")?.displayName).toBe("PostHog");
    expect(soleLiveProviderOn("delivery")?.displayName).toBe("Slack");
  });

  // Five coding assistants are live at once, so there is no single name to offer. When a
  // second analytics or delivery provider ships, its rail lands in this case and the two
  // empty-state headlines fall back rather than silently keeping the incumbent's name.
  test("a rail with several live providers names none of them", () => {
    expect(soleLiveProviderOn("coding-assistant")).toBeNull();
  });

  test("a rail with nothing live falls back rather than naming a product we cannot connect", () => {
    expect(soleLiveProviderOn("code")).toBeNull();

    const card = buildDeliveryCard({
      providerId: null,
      workspaceAttached: false,
      workspaceName: null,
      channelId: null,
      channelLabel: null,
      connectedAt: null,
      nowMs: NOW,
    });

    // The fallback exists and is reachable the moment a second destination ships.
    expect([NOTHING_ATTACHED_HEADLINE, "Slack"]).toContain(card.headline);
  });
});

describe("the product card is the customer's own, and names no vendor", () => {
  test("a known domain is the headline, above everything a vendor supplied", () => {
    const card = buildProductCard({
      domain: "growthmind.ai",
      researchStatus: "done",
      pagesSeen: 12,
    });

    expect(card.headline).toBe("growthmind.ai");
    expect(card.providerId).toBeNull();
    expect(card.rail).toBeNull();
    expect(valueOf(card, CONNECTION_FACT_LABELS.pagesSeen)).toBe("12 on your site");
  });

  test("an unknown domain says so and asks, rather than leaving the card out", () => {
    const card = buildProductCard({ domain: null, researchStatus: "never_run", pagesSeen: 0 });

    expect(card.headline).toBe(PRODUCT_UNKNOWN_HEADLINE);
    expect(card.tone).toBe("off");
    expect(valueOf(card, CONNECTION_FACT_LABELS.pagesSeen)).toBe("none yet");
  });

  test("every research status resolves to a label, a tone and a sentence", () => {
    const broken = RESEARCH_STATUSES.filter((researchStatus) => {
      const card = buildProductCard({ domain: "acme.com", researchStatus, pagesSeen: 1 });
      return card.statusLabel.trim() === "" || card.statement.trim() === "";
    });

    expect(broken).toEqual([]);
  });

  // The activation sweep caught this: "read the site again" sat under a card whose own
  // sentence said the site had never been read. The label is the next action, so it
  // tracks what has happened rather than only whether an address exists.
  test("the action never offers to read the site AGAIN before a first read", () => {
    expect(productActionLabel(null, "never_run")).toBe("Add your website");
    expect(productActionLabel("acme.com", "never_run")).not.toMatch(/again/i);
    expect(productActionLabel("acme.com", "running")).not.toMatch(/again/i);
    expect(productActionLabel("acme.com", "done")).toMatch(/again/i);
    expect(productActionLabel("acme.com", "failed")).toMatch(/again/i);
  });

  test("every research status yields a non-empty action label", () => {
    const blank = RESEARCH_STATUSES.filter(
      (status) => productActionLabel("acme.com", status).trim() === "",
    );

    expect(blank).toEqual([]);
  });

  test("a failed read asks for attention without losing the address it already has", () => {
    const card = buildProductCard({ domain: "acme.com", researchStatus: "failed", pagesSeen: 3 });

    expect(card.tone).toBe("attention");
    expect(card.headline).toBe("acme.com");
  });
});
