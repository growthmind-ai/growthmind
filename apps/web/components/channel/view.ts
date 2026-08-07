import {
  DELIVERY_LANE_FAILURE_CLAUSE,
  DELIVERY_STATUS_MESSAGES,
  POST_FAILURE_MESSAGES,
  RESIDUAL_PII_KIND_MESSAGES,
  describeSince,
} from "@growthmind/shared";

import { ROUTES } from "@/lib/routes";
import { findingPath } from "@/lib/paths";

import {
  describeChannel,
  deriveDeliveryState,
  holdOf,
  ordinal,
  readFailureCause,
  type ConnectedChannel,
  type DeliveryFacts,
  type DeliveryStateKey,
} from "./derive";
import { counted, dayMonthSecond, dayMonthTime } from "./format";
import type { LaneHistoryRow, LaneLine } from "./lane";

export type Dot = "ok" | "run" | "hold" | "err";
export type CardTone = "plain" | "failed" | "held";

export interface ReceiptRow {
  readonly pip: Dot;
  readonly text: string;
  readonly detail: string | null;
}

export interface BodyBlockView {
  readonly key: string;
  readonly kind: "section" | "context";
  readonly text: string;
}

export type MessageBodyView =
  | {
      readonly kind: "held";
      readonly blocks: readonly BodyBlockView[];
      readonly actionLabels: readonly string[];
    }
  | { readonly kind: "absent"; readonly note: string };

export type RepairView =
  | { readonly kind: "link"; readonly href: string; readonly label: string }
  | { readonly kind: "note"; readonly text: string };

export interface DeliveryCardView {
  readonly id: string;
  readonly state: DeliveryStateKey;
  readonly tone: CardTone;
  readonly dot: Dot;
  readonly sentAt: string;
  readonly channelNote: string;
  readonly strip: string;
  readonly receipt: readonly ReceiptRow[];
  readonly why: string;
  readonly openOnPaint: boolean;
  readonly body: MessageBodyView;
  readonly dimmed: boolean;
  readonly findingHref: string;
  readonly repair: RepairView | null;
}

export interface RecordCounts {
  readonly total: number;
  readonly arrived: number;
  readonly failed: number;
  readonly held: number;
  readonly inFlight: number;
  readonly stalled: number;
}

export type ConnectionState =
  | { readonly kind: "delivering"; readonly channel: string }
  // The workspace is attached and the address is empty. Naming this "no Slack" sends someone
  // to reconnect something already connected.
  | { readonly kind: "no_channel" }
  // `getActiveForOrg` returns null for both "revoked" and "never connected", so the record
  // itself is the evidence: rows exist only if a channel once did.
  | { readonly kind: "disconnected" }
  | { readonly kind: "never_connected" }
  // Reachable only from a read that threw, never from an absence. The other four are all
  // inferred from the two values a failed read used to return, so a connection nobody could
  // look at was being declared dead and a repair offered for it (D10).
  | { readonly kind: "unavailable" };

/** Which of the page's four independent reads did not answer. Each degrades on its own. */
export interface ChannelUnread {
  readonly record: boolean;
  readonly lane: boolean;
  readonly laneHistory: boolean;
  readonly dismissals: boolean;
}

export interface ChannelView {
  readonly connection: ConnectionState;
  readonly counts: RecordCounts;
  readonly cards: readonly DeliveryCardView[];
  readonly lane: LaneLine | null;
  readonly laneHistory: readonly LaneHistoryRow[];
  readonly truncatedAt: number | null;
  readonly unread: ChannelUnread;
}

const DISMISSAL_LABELS: Record<"not_useful", string> = { not_useful: "Not useful" };

const WHY_DISMISSED =
  "Nobody on this team will see this one again. It stays here because it was sent.";

const WHY_POSTED =
  "Nothing happens next. It is in the channel; anything worth answering, you answer there.";

// No live topic carries a delivery change to this page yet, so it does not claim to update
// itself. See the P3 note in .ai/ux/channel-delivery.interaction.html.
const WHY_POSTING =
  "This is going out right now. There is nothing to press — the next time you open this page it will say where it got to.";

const WHY_STALLED =
  "Something stopped part-way through sending this. It has not arrived and it has not failed — the next run will pick it up and try again.";

function whyRetried(attempts: number): string {
  return (
    `${counted(attempts - 1, "earlier attempt")} did not get through. We do not keep why — a ` +
    `delivery that succeeds clears its own failure record, so we will not guess at it here.`
  );
}

function absentNote(facts: DeliveryFacts, sentAt: Date): string {
  return facts.status === "posted"
    ? `We did not keep a copy of this one. It went out on ${dayMonthTime(sentAt)}, before we ` +
        `started saving what we send. We can still show you what it was about — we just will ` +
        `not put words in our own mouth about how we said it.`
    : "Nothing was sent, so there is no copy of it to show. What we found has not changed — " +
        "the receipt below is what happened when we tried.";
}

function bodyOf(facts: DeliveryFacts, sentAt: Date): MessageBodyView {
  const hold = holdOf(facts);
  if (hold.kind !== "held") {
    return { kind: "absent", note: absentNote(facts, sentAt) };
  }

  const blocks: BodyBlockView[] = [];
  let actionLabels: readonly string[] = [];

  for (const block of hold.message.blocks) {
    if (block.kind === "actions") {
      actionLabels = block.actions.map((action) => action.label);
      continue;
    }
    blocks.push({ key: `${blocks.length}`, kind: block.kind, text: block.text });
  }

  return { kind: "held", blocks, actionLabels };
}

function repairOf(facts: DeliveryFacts): RepairView | null {
  const cause = readFailureCause(facts.failureReason);
  if (cause.kind !== "post_failure" || cause.code === null) {
    return null;
  }

  if (cause.code === "not_authorised") {
    return { kind: "link", href: ROUTES.settings, label: "Reconnect Slack →" };
  }

  const clause = DELIVERY_LANE_FAILURE_CLAUSE[cause.code];
  return clause === null ? null : { kind: "note", text: clause };
}

// The sentence a founder reads for a failure is resolved from the parsed code, so an
// unrecognised `failure_reason` degrades to the shared "we cannot tell you more" sentence
// rather than putting Slack's own words — and its internal ids — on the screen.
function whyFailed(facts: DeliveryFacts): string {
  const cause = readFailureCause(facts.failureReason);
  if (cause.kind === "residual_pii") {
    return RESIDUAL_PII_KIND_MESSAGES[cause.pii];
  }

  return cause.code === null
    ? (DELIVERY_STATUS_MESSAGES.failed ?? "")
    : POST_FAILURE_MESSAGES[cause.code];
}

export interface DeliveryInput extends DeliveryFacts {
  readonly id: string;
  readonly findingId: string;
  readonly channelId: string;
  readonly dismissedAs: "not_useful" | null;
  readonly dismissedAt: Date | null;
}

export interface CardContext {
  readonly connection: ConnectedChannel | null;
  readonly staleClaimsBefore: Date;
  readonly nowMs: number;
}

export function toCard(row: DeliveryInput, ctx: CardContext): DeliveryCardView {
  const state = deriveDeliveryState(row, ctx.staleClaimsBefore);
  const channel = describeChannel(row.channelId, ctx.connection);
  const sentAt = row.postedAt ?? row.claimedAt;
  const since = describeSince(row.claimedAt, ctx.nowMs);
  const dismissed = row.dismissedAs !== null && row.dismissedAt !== null;

  const parts = stateParts(state, row, channel, since);

  const receipt = dismissed
    ? [
        ...parts.receipt,
        {
          pip: "ok" as const,
          text: `${DISMISSAL_LABELS[row.dismissedAs ?? "not_useful"]} pressed in Slack, ${dayMonthTime(row.dismissedAt ?? sentAt)}`,
          detail: null,
        },
      ]
    : parts.receipt;

  return {
    id: row.id,
    state,
    tone: parts.tone,
    dot: parts.dot,
    sentAt: dayMonthTime(row.claimedAt),
    channelNote: channel,
    strip: dismissed && row.status === "posted" ? "Posted, then dismissed in Slack" : parts.strip,
    receipt,
    why: dismissed ? WHY_DISMISSED : parts.why,
    openOnPaint: parts.openOnPaint,
    body: bodyOf(row, sentAt),
    dimmed: dismissed,
    findingHref: findingPath(row.findingId),
    repair: state === "failed" ? repairOf(row) : null,
  };
}

interface StateParts {
  readonly dot: Dot;
  readonly tone: CardTone;
  readonly strip: string;
  readonly receipt: readonly ReceiptRow[];
  readonly why: string;
  readonly openOnPaint: boolean;
}

// One descriptor per derived state rather than a switch on `status`: `held_back` and `failed`
// share a column and belong in different lanes, and a new state is a new entry here.
function stateParts(
  state: DeliveryStateKey,
  row: DeliveryInput,
  channel: string,
  since: string,
): StateParts {
  const sentAt = row.postedAt ?? row.claimedAt;
  const failedAt = row.failedAt ?? row.claimedAt;

  switch (state) {
    case "posted":
      return {
        dot: "ok",
        tone: "plain",
        strip: `Posted to ${channel}, ${dayMonthTime(sentAt)}`,
        receipt: [
          { pip: "ok", text: `Picked up ${dayMonthSecond(row.claimedAt)}`, detail: null },
          { pip: "ok", text: `Posted ${dayMonthSecond(sentAt)}`, detail: "first attempt" },
        ],
        why: WHY_POSTED,
        openOnPaint: false,
      };

    case "posted_retried":
      return {
        dot: "ok",
        tone: "plain",
        strip: `Posted to ${channel} on the ${ordinal(row.attempts)} try`,
        receipt: [
          {
            pip: "ok",
            text: `Posted ${dayMonthSecond(sentAt)}`,
            detail: `attempt ${row.attempts}`,
          },
        ],
        why: whyRetried(row.attempts),
        openOnPaint: false,
      };

    case "posting":
      return {
        dot: "run",
        tone: "plain",
        strip: `Posting to ${channel} now…`,
        receipt: [{ pip: "run", text: `Picked up ${since}`, detail: `attempt ${row.attempts}` }],
        why: WHY_POSTING,
        openOnPaint: false,
      };

    case "stalled":
      return {
        dot: "hold",
        tone: "plain",
        strip: `Started ${since} and did not finish`,
        receipt: [
          { pip: "run", text: `Picked up ${since}`, detail: `attempt ${row.attempts}` },
          { pip: "hold", text: "No result recorded since", detail: null },
        ],
        why: WHY_STALLED,
        openOnPaint: false,
      };

    case "held_back":
      return {
        dot: "hold",
        tone: "held",
        strip: "We held this back — not a failure",
        receipt: [
          {
            pip: "hold",
            text: `Held back ${dayMonthSecond(failedAt)}`,
            detail: "before anything was sent",
          },
          {
            pip: "hold",
            text: "Not retried",
            detail: "nothing we send again would be different",
          },
        ],
        why: whyFailed(row),
        openOnPaint: true,
      };

    case "failed":
      return {
        dot: "err",
        tone: "failed",
        strip: `Did not reach ${channel}`,
        receipt: [
          {
            pip: "run",
            text: `Tried ${counted(row.attempts, "time")}`,
            detail: `last at ${dayMonthTime(failedAt)}`,
          },
          { pip: "err", text: "Still not in the channel", detail: null },
        ],
        why: whyFailed(row),
        openOnPaint: true,
      };
  }
}

export function countRecord(cards: readonly DeliveryCardView[]): RecordCounts {
  const counts = {
    total: cards.length,
    arrived: 0,
    failed: 0,
    held: 0,
    inFlight: 0,
    stalled: 0,
  };

  for (const card of cards) {
    if (card.state === "failed") counts.failed += 1;
    else if (card.state === "held_back") counts.held += 1;
    else if (card.state === "posting") counts.inFlight += 1;
    else if (card.state === "stalled") counts.stalled += 1;
    else counts.arrived += 1;
  }

  return counts;
}

export interface HealthSentence {
  readonly arrived: string;
  readonly where: string;
  readonly extras: readonly string[];
}

// Four buckets, because only one of them is bad news: folding "going out now" into "did not
// reach" would report a message mid-flight as a shortfall.
export function healthSentence(
  counts: RecordCounts,
  connection: ConnectionState,
): HealthSentence | null {
  if (counts.total === 0) {
    return null;
  }

  const extras: string[] = [];
  if (counts.failed > 0) {
    extras.push(
      counts.failed === 1
        ? "One did not — it is below, opened for you."
        : `${counts.failed} did not — they are below, opened for you.`,
    );
  }
  if (counts.held > 0) {
    extras.push(
      counts.held === 1
        ? "One we held back on purpose."
        : `${counts.held} we held back on purpose.`,
    );
  }
  if (counts.inFlight > 0) {
    extras.push(
      counts.inFlight === 1 ? "One more on the way." : `${counts.inFlight} more on the way.`,
    );
  }
  // A stalled claim is not "on the way" — it stopped, and will be retried.
  if (counts.stalled > 0) {
    extras.push(
      counts.stalled === 1
        ? "One stalled part-way and will be tried again."
        : `${counts.stalled} stalled part-way and will be tried again.`,
    );
  }

  return {
    arrived: `${counts.arrived} of ${counts.total}`,
    where: connection.kind === "delivering" ? connection.channel : "your channel",
    extras,
  };
}
