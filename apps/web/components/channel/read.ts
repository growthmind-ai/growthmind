import { deliveryClaimsExpireBefore } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  createDeliveriesRepo,
  createDeliveryDecisionsRepo,
  createDismissalsRepo,
  createSlackConnectionsRepo,
} from "@growthmind/db";
import { isDeliveryAddress, type TenantContext } from "@growthmind/shared";

import { tryRead } from "@/lib/read-or-fallback";

import type { ConnectedChannel } from "./derive";
import { laneHistory, laneLine, type LaneRunFacts } from "./lane";
import {
  countRecord,
  toCard,
  type ChannelView,
  type ConnectionState,
  type DeliveryCardView,
  type DeliveryInput,
} from "./view";

// The weekly ceiling is three findings, so this is roughly four months of record. The
// counting sentence is stated over exactly the rows below it, and says so when it is cut off.
const RECORD_LIMIT = 50;

const LANE_HISTORY_LIMIT = 6;

export interface ReadChannelViewInput {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly nowMs: number;
}

function connectionStateOf(
  connection: ConnectedChannel | null,
  attached: boolean,
  hasRecord: boolean,
): ConnectionState {
  if (connection !== null) {
    const name = (connection.channelName ?? "").trim().replace(/^#+/, "").trim();
    return { kind: "delivering", channel: name.length > 0 ? `#${name}` : "the connected channel" };
  }

  // The workspace is attached and the address is empty, which is a different repair.
  if (attached) {
    return { kind: "no_channel" };
  }

  // `getActiveForOrg` answers null for a revoked connection and for one that never existed
  // alike, so the record is what separates them: rows exist only if a channel once did.
  return hasRecord ? { kind: "disconnected" } : { kind: "never_connected" };
}

export async function readChannelView(input: ReadChannelViewInput): Promise<ChannelView> {
  const { db, ctx, projectId, nowMs } = input;
  const now = new Date(nowMs);

  const [active, rows] = await Promise.all([
    tryRead(
      () => createSlackConnectionsRepo(db, ctx).getActiveForOrg(),
      "channel: the Slack connection could not be read",
      { projectId },
    ),
    tryRead(
      () => createDeliveriesRepo(db, ctx).listRecentForOrg(RECORD_LIMIT),
      "channel: the delivery record could not be read",
      { projectId },
    ),
  ]);

  const record = rows.ok ? rows.value : [];
  const slack = active.ok ? active.value : null;

  const connection: ConnectedChannel | null =
    slack !== null && slack.channelId !== null && isDeliveryAddress(slack.channelId)
      ? { channelId: slack.channelId, channelName: slack.channelName }
      : null;

  // An unreadable record cannot prove a channel once existed, and it cannot disprove it
  // either — so it resolves to the arm that offers a repair rather than the one that greets
  // a running workspace with "connect Slack".
  const state: ConnectionState = active.ok
    ? connectionStateOf(connection, slack !== null, rows.ok ? record.length > 0 : true)
    : { kind: "unavailable" };

  // The lane answers "why has it been quiet?" — worth having, never worth taking the record
  // down with it (D8).
  const decisions = createDeliveryDecisionsRepo(db, ctx);
  const [currentRun, recentRuns] = await Promise.all([
    tryRead(
      () => decisions.currentForProject(projectId),
      "channel: the open delivery decision could not be read",
      { projectId },
    ),
    tryRead<readonly LaneRunFacts[]>(
      () => decisions.listRecentForProject(projectId, LANE_HISTORY_LIMIT),
      "channel: the delivery decision history could not be read",
      { projectId },
    ),
  ]);

  // A delivery that never posted carries no Slack message, so nothing there can have been
  // dismissed in Slack — the lookup is skipped rather than answered.
  const dismissals = createDismissalsRepo(db, ctx);
  const lookups = await Promise.all(
    record.map(async (row) =>
      row.status === "posted"
        ? tryRead(
            () => dismissals.findFor(row.findingId, "not_useful"),
            "channel: a dismissal could not be read",
            {
              findingId: row.findingId,
            },
          )
        : null,
    ),
  );

  const staleClaimsBefore = deliveryClaimsExpireBefore(now);

  const cards: DeliveryCardView[] = record.map((row, index) => {
    const lookup = lookups[index];
    const seen = lookup !== null && lookup !== undefined && lookup.ok ? lookup.value : null;

    const delivery: DeliveryInput = {
      id: row.id,
      findingId: row.findingId,
      channelId: row.channelId,
      status: row.status,
      attempts: row.attempts,
      claimedAt: row.claimedAt,
      postedAt: row.postedAt,
      failedAt: row.failedAt,
      failureReason: row.failureReason,
      renderedMessage: row.renderedMessage,
      dismissedAs: seen ? seen.action : null,
      dismissedAt: seen ? seen.dismissedAt : null,
    };

    return toCard(delivery, { connection, staleClaimsBefore, nowMs });
  });

  // A never-connected workspace is told to connect a channel and nothing else; the lane is
  // already silent there, so its own failure has nothing to say either.
  const silentLane = state.kind === "never_connected";

  return {
    connection: state,
    counts: countRecord(cards),
    cards,
    lane: silentLane || !currentRun.ok ? null : laneLine(currentRun.value, now),
    laneHistory: recentRuns.ok ? laneHistory(recentRuns.value) : [],
    truncatedAt: record.length === RECORD_LIMIT ? RECORD_LIMIT : null,
    unread: {
      record: !rows.ok,
      lane: !currentRun.ok && !silentLane,
      laneHistory: !recentRuns.ok && !silentLane,
      dismissals: lookups.some((lookup) => lookup !== null && !lookup.ok),
    },
  };
}
