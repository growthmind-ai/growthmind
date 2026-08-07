import { deliveryClaimsExpireBefore } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  createDeliveriesRepo,
  createDeliveryDecisionsRepo,
  createDismissalsRepo,
  createSlackConnectionsRepo,
} from "@growthmind/db";
import { isDeliveryAddress, type TenantContext } from "@growthmind/shared";

import { readOrFallback } from "@/lib/read-or-fallback";

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
  hasRecord: boolean,
): ConnectionState {
  // `getActiveForOrg` answers null for a revoked connection and for one that never existed
  // alike, so the record is what separates them: rows exist only if a channel once did.
  if (connection === null) {
    return hasRecord ? { kind: "disconnected" } : { kind: "never_connected" };
  }

  const name = (connection.channelName ?? "").trim().replace(/^#+/, "").trim();
  return { kind: "delivering", channel: name.length > 0 ? `#${name}` : "the connected channel" };
}

export async function readChannelView(input: ReadChannelViewInput): Promise<ChannelView> {
  const { db, ctx, projectId, nowMs } = input;
  const now = new Date(nowMs);

  const [active, rows] = await Promise.all([
    readOrFallback(
      () => createSlackConnectionsRepo(db, ctx).getActiveForOrg(),
      null,
      "channel: the Slack connection could not be read",
      { projectId },
    ),
    readOrFallback(
      () => createDeliveriesRepo(db, ctx).listRecentForOrg(RECORD_LIMIT),
      [],
      "channel: the delivery record could not be read",
      { projectId },
    ),
  ]);

  // The lane answers "why has it been quiet?" — worth having, never worth taking the record
  // down with it (D8).
  const decisions = createDeliveryDecisionsRepo(db, ctx);
  const [currentRun, recentRuns] = await Promise.all([
    readOrFallback(
      () => decisions.currentForProject(projectId),
      null,
      "channel: the open delivery decision could not be read",
      { projectId },
    ),
    readOrFallback<readonly LaneRunFacts[]>(
      () => decisions.listRecentForProject(projectId, LANE_HISTORY_LIMIT),
      [],
      "channel: the delivery decision history could not be read",
      { projectId },
    ),
  ]);

  const connection: ConnectedChannel | null =
    active !== null && active.channelId !== null && isDeliveryAddress(active.channelId)
      ? { channelId: active.channelId, channelName: active.channelName }
      : null;

  // A delivery that never posted carries no Slack message, so nothing there can have been
  // dismissed in Slack — the lookup is skipped rather than answered.
  const dismissals = createDismissalsRepo(db, ctx);
  const dismissed = await Promise.all(
    rows.map(async (row) =>
      row.status === "posted"
        ? readOrFallback(
            () => dismissals.findFor(row.findingId, "not_useful"),
            null,
            "channel: a dismissal could not be read",
            { findingId: row.findingId },
          )
        : null,
    ),
  );

  const staleClaimsBefore = deliveryClaimsExpireBefore(now);

  const cards: DeliveryCardView[] = rows.map((row, index) => {
    const seen = dismissed[index];
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

  const state = connectionStateOf(connection, rows.length > 0);
  const noChannel = active !== null && connection === null;

  return {
    connection: noChannel ? { kind: "no_channel" } : state,
    counts: countRecord(cards),
    cards,
    lane: state.kind === "never_connected" ? null : laneLine(currentRun, now),
    laneHistory: laneHistory(recentRuns),
    truncatedAt: rows.length === RECORD_LIMIT ? RECORD_LIMIT : null,
  };
}
