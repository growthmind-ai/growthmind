import type { ResearchStatus } from "../growth/provenance";
import { describeSince } from "../onboarding/liveness";
// The sentence a founder with nowhere to deliver has always been shown. It keeps its one
// home rather than being restated here in a second, drifting copy.
import { SETTINGS_NO_DELIVERY_LINE } from "../onboarding/messages";
import {
  providerDisplayName,
  soleLiveProviderOn,
  type ProviderId,
  type ProviderRail,
} from "../onboarding/providers";
import type { ConnectionStateStatus } from "../session-source/types";
import {
  ANALYTICS_CARD_TITLE,
  ANALYTICS_STATUS_LABELS,
  ANALYTICS_STATUS_TONES,
  CHECK_EVERY_MINUTES_TEMPLATE,
  CHECK_EVERY_SECONDS_TEMPLATE,
  CONNECTION_FACT_LABELS,
  DELIVERY_CARD_TITLE,
  DELIVERY_LIVE_STATEMENT,
  DELIVERY_NO_CHANNEL_STATEMENT,
  DELIVERY_STATUS_LIVE,
  DELIVERY_STATUS_NO_CHANNEL,
  DELIVERY_STATUS_NONE,
  EVENTS_FACT_TEMPLATE,
  EVENTS_NONE_YET,
  EVENTS_SET_ASIDE_SUFFIX_TEMPLATE,
  NOTHING_ATTACHED_HEADLINE,
  PAGES_SEEN_NONE,
  PAGES_SEEN_TEMPLATE,
  PRODUCT_CARD_TITLE,
  PRODUCT_EDIT_ACTION,
  PRODUCT_FAILED_STATEMENT,
  PRODUCT_NEVER_READ_STATEMENT,
  PRODUCT_READ_ACTION,
  PRODUCT_READ_STATEMENT,
  PRODUCT_READING_STATEMENT,
  PRODUCT_REREAD_ACTION,
  PRODUCT_SET_ACTION,
  PRODUCT_STATUS_FAILED,
  PRODUCT_STATUS_NEVER_READ,
  PRODUCT_STATUS_READ,
  PRODUCT_STATUS_READING,
  PRODUCT_STATUS_UNKNOWN,
  PRODUCT_UNKNOWN_HEADLINE,
  PRODUCT_UNKNOWN_STATEMENT,
  WORKSPACE_UNNAMED,
} from "./messages";
import type { ConnectionCardView, ConnectionFact, ConnectionTone } from "./types";

// A fact with nothing behind it is not rendered dimmed, it is not rendered: a labelled
// blank reads as a value that went missing rather than one that was never collected.
function facts(entries: readonly (readonly [string, string | null])[]): readonly ConnectionFact[] {
  const kept: ConnectionFact[] = [];

  for (const [label, value] of entries) {
    if (value !== null && value.trim() !== "") {
      kept.push({ label, value });
    }
  }

  return kept;
}

function since(when: Date | null, nowMs: number): string | null {
  return when === null ? null : describeSince(when, nowMs);
}

// Attached, the headline is what you are attached to. Unattached, it is what this rail
// would attach to — a card headed "Nothing connected" beside a Slack token field makes a
// reader work out the vendor from a field's help text.
function headlineFor(attached: ProviderId | null, rail: ProviderRail): string {
  if (attached !== null) {
    return providerDisplayName(attached);
  }

  return soleLiveProviderOn(rail)?.displayName ?? NOTHING_ATTACHED_HEADLINE;
}

// Minutes only once they read better than the seconds would: at 60 the seconds are the
// familiar number, and "every 1 minutes" is the phrasing this avoids.
export function describeCadence(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) {
    return null;
  }

  if (seconds >= 120 && seconds % 60 === 0) {
    return CHECK_EVERY_MINUTES_TEMPLATE.replaceAll("{count}", String(seconds / 60));
  }

  return CHECK_EVERY_SECONDS_TEMPLATE.replaceAll("{count}", String(seconds));
}

export function describeEventVolume(input: {
  readonly received: number;
  readonly kept: number;
  readonly setAside: number;
}): string {
  if (input.received === 0) {
    return EVENTS_NONE_YET;
  }

  const counted = EVENTS_FACT_TEMPLATE.replaceAll("{kept}", String(input.kept)).replaceAll(
    "{total}",
    String(input.received),
  );

  if (input.setAside === 0) {
    return counted;
  }

  return `${counted}${EVENTS_SET_ASIDE_SUFFIX_TEMPLATE.replaceAll("{setAside}", String(input.setAside))}`;
}

// The link's label is the next action, so it tracks what has actually happened to the
// site rather than only whether an address exists.
export function productActionLabel(domain: string | null, researchStatus: ResearchStatus): string {
  if (domain === null) return PRODUCT_SET_ACTION;

  switch (researchStatus) {
    case "never_run":
      return PRODUCT_READ_ACTION;
    case "running":
      return PRODUCT_EDIT_ACTION;
    case "done":
    case "failed":
      return PRODUCT_REREAD_ACTION;
  }
}

export interface ProductCardInput {
  readonly domain: string | null;
  readonly researchStatus: ResearchStatus;

  readonly pagesSeen: number;
}

const PRODUCT_STATUS_BY_RESEARCH: Record<
  ResearchStatus,
  { readonly label: string; readonly tone: ConnectionTone; readonly statement: string }
> = {
  never_run: {
    label: PRODUCT_STATUS_NEVER_READ,
    tone: "waiting",
    statement: PRODUCT_NEVER_READ_STATEMENT,
  },
  running: { label: PRODUCT_STATUS_READING, tone: "waiting", statement: PRODUCT_READING_STATEMENT },
  failed: { label: PRODUCT_STATUS_FAILED, tone: "attention", statement: PRODUCT_FAILED_STATEMENT },
  done: { label: PRODUCT_STATUS_READ, tone: "live", statement: PRODUCT_READ_STATEMENT },
};

// No rail and no provider: this is the customer's own product, and naming a vendor beside
// it would claim the vendor told us, which nothing did — the address is theirs to state.
export function buildProductCard(input: ProductCardInput): ConnectionCardView {
  const seen =
    input.pagesSeen === 0
      ? PAGES_SEEN_NONE
      : PAGES_SEEN_TEMPLATE.replaceAll("{count}", String(input.pagesSeen));

  if (input.domain === null) {
    return {
      rail: null,
      providerId: null,
      title: PRODUCT_CARD_TITLE,
      headline: PRODUCT_UNKNOWN_HEADLINE,
      tone: "off",
      statusLabel: PRODUCT_STATUS_UNKNOWN,
      statement: PRODUCT_UNKNOWN_STATEMENT,
      facts: facts([[CONNECTION_FACT_LABELS.pagesSeen, seen]]),
    };
  }

  const status = PRODUCT_STATUS_BY_RESEARCH[input.researchStatus];

  return {
    rail: null,
    providerId: null,
    title: PRODUCT_CARD_TITLE,
    headline: input.domain,
    tone: status.tone,
    statusLabel: status.label,
    statement: status.statement,
    facts: facts([[CONNECTION_FACT_LABELS.pagesSeen, seen]]),
  };
}

export interface AnalyticsCardInput {
  // Null when nothing is attached. Named rather than assumed, so a second analytics
  // provider needs no change here beyond being passed.
  readonly providerId: ProviderId | null;

  readonly status: ConnectionStateStatus;

  readonly statement: string;

  readonly host: string | null;
  readonly sourceProjectId: string | null;

  readonly eventsReceived: number;
  readonly eventsKept: number;
  readonly eventsSetAside: number;

  // The newest event we have seen, which is the product's own liveness.
  readonly newestSessionAt: Date | null;

  // The last completed check, which is the connection's liveness. A quiet product keeps
  // this fresh while `newestSessionAt` ages, and the two answer different questions.
  readonly lastCheckAt: Date | null;

  readonly connectedAt: Date | null;
  readonly pollIntervalSeconds: number | null;

  readonly failure: string | null;

  readonly nowMs: number;
}

export function buildAnalyticsCard(input: AnalyticsCardInput): ConnectionCardView {
  const attached = input.providerId !== null && input.status !== "not_connected";

  return {
    rail: "analytics",
    providerId: input.providerId,
    title: ANALYTICS_CARD_TITLE,
    headline: headlineFor(input.providerId, "analytics"),
    tone: ANALYTICS_STATUS_TONES[input.status],
    statusLabel: ANALYTICS_STATUS_LABELS[input.status],
    statement: input.statement,
    facts: attached
      ? facts([
          [CONNECTION_FACT_LABELS.project, input.sourceProjectId],
          [CONNECTION_FACT_LABELS.address, input.host],
          [
            CONNECTION_FACT_LABELS.events,
            describeEventVolume({
              received: input.eventsReceived,
              kept: input.eventsKept,
              setAside: input.eventsSetAside,
            }),
          ],
          [CONNECTION_FACT_LABELS.newestSession, since(input.newestSessionAt, input.nowMs)],
          [CONNECTION_FACT_LABELS.lastCheck, since(input.lastCheckAt, input.nowMs)],
          [CONNECTION_FACT_LABELS.checkEvery, describeCadence(input.pollIntervalSeconds)],
          [CONNECTION_FACT_LABELS.connectedSince, since(input.connectedAt, input.nowMs)],
          [CONNECTION_FACT_LABELS.problem, input.failure],
        ])
      : [],
  };
}

export interface DeliveryCardInput {
  readonly providerId: ProviderId | null;

  readonly workspaceAttached: boolean;
  readonly workspaceName: string | null;

  // Narrowed upstream through `isDeliveryTarget`, so a sentinel row arrives here as null.
  readonly channelId: string | null;
  readonly channelLabel: string | null;

  readonly connectedAt: Date | null;

  readonly nowMs: number;
}

export function buildDeliveryCard(input: DeliveryCardInput): ConnectionCardView {
  const providerName = headlineFor(input.providerId, "delivery");

  if (!input.workspaceAttached || input.providerId === null) {
    return {
      rail: "delivery",
      providerId: null,
      title: DELIVERY_CARD_TITLE,
      headline: providerName,
      tone: "off",
      statusLabel: DELIVERY_STATUS_NONE,
      statement: SETTINGS_NO_DELIVERY_LINE,
      facts: [],
    };
  }

  const workspace = input.workspaceName ?? WORKSPACE_UNNAMED;

  if (input.channelId === null) {
    return {
      rail: "delivery",
      providerId: input.providerId,
      title: DELIVERY_CARD_TITLE,
      headline: providerName,
      tone: "attention",
      statusLabel: DELIVERY_STATUS_NO_CHANNEL,
      statement: DELIVERY_NO_CHANNEL_STATEMENT,
      facts: facts([
        [CONNECTION_FACT_LABELS.workspace, workspace],
        [CONNECTION_FACT_LABELS.connectedSince, since(input.connectedAt, input.nowMs)],
      ]),
    };
  }

  return {
    rail: "delivery",
    providerId: input.providerId,
    title: DELIVERY_CARD_TITLE,
    headline: providerName,
    tone: "live",
    statusLabel: DELIVERY_STATUS_LIVE,
    statement: DELIVERY_LIVE_STATEMENT,
    facts: facts([
      [CONNECTION_FACT_LABELS.workspace, workspace],
      [CONNECTION_FACT_LABELS.channel, input.channelLabel ?? input.channelId],
      [CONNECTION_FACT_LABELS.connectedSince, since(input.connectedAt, input.nowMs)],
    ]),
  };
}
