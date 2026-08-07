import {
  agentFirstContactSentence,
  findingDeliveredSentence,
  genericNotificationSentence,
  keysRevokedSentence,
} from "@growthmind/core";
import {
  channelLabel,
  parseNotificationPayload,
  type NotificationEmptyVariant,
  type NotificationSubjectKind,
  type TenantContext,
} from "@growthmind/shared";
import { inArray } from "drizzle-orm";

import { readFindingText } from "../repositories/finding-text";
import {
  createNotificationsRepo,
  type NotificationWithReadState,
} from "../repositories/notifications.repo";
import { scoped } from "../repositories/scope";
import {
  createSlackConnectionsRepo,
  type SlackConnectionSummary,
} from "../repositories/slack-connections.repo";
import type { ScopedDb } from "../repositories/types";
import { analysisRuns } from "../schema/analysis-runs";
import { user } from "../schema/auth";
import { findings } from "../schema/findings";
import { isDeliveryTarget } from "./delivery-channel-guard";

export interface BellSnapshotChip {
  readonly kind: "sent" | "failed" | "quiet";
  readonly channelLabel: string | null;
}

export interface BellSnapshotRow {
  readonly id: string;
  readonly sentence: string;
  readonly subjectKind: NotificationSubjectKind;
  readonly subjectId: string;
  readonly unread: boolean;
  readonly createdAtIso: string;
  readonly chip: BellSnapshotChip | null;
}

export interface BellSnapshot {
  readonly badgeCount: number;
  readonly rows: readonly BellSnapshotRow[];

  // Null whenever rows exist; the popover needs an empty sentence only when it is empty.
  readonly emptyVariant: NotificationEmptyVariant | null;
}

export interface ReadBellSnapshotOptions {
  readonly limit: number;
  readonly windowDays: number;
}

interface RenderSeams {
  readonly namesById: ReadonlyMap<string, string>;
  readonly findingTextRowsById: ReadonlyMap<string, { headline: string; context: unknown }>;
  readonly organizationName: string;
}

// Resolve-at-render (ADD §3, OQ-3): v1 payloads carry nothing, so the sentence is built
// from live rows — the actor's current name, the finding's scanned text — through the
// same seams the record pages read.
function sentenceOf(row: NotificationWithReadState, seams: RenderSeams): string {
  const parsed = parseNotificationPayload(row.payload);

  if (!parsed.ok) {
    return genericNotificationSentence();
  }

  switch (parsed.payload.type) {
    case "finding_delivered": {
      const findingRow = seams.findingTextRowsById.get(row.subjectId);

      return findingRow
        ? findingDeliveredSentence(readFindingText(findingRow))
        : genericNotificationSentence();
    }
    case "keys_revoked": {
      const revokedByName =
        row.actorUserId === null ? null : (seams.namesById.get(row.actorUserId) ?? null);

      return keysRevokedSentence({ workspaceName: seams.organizationName, revokedByName });
    }
    case "agent_first_contact":
      return agentFirstContactSentence();
  }
}

function chipOf(
  row: NotificationWithReadState,
  connection: SlackConnectionSummary | null,
): BellSnapshotChip | null {
  const send = row.sends.find((candidate) => candidate.channel === "slack");

  // No receipt yet means the dispatch job still owns the outcome — no chip beats a
  // guessed one.
  if (!send) {
    return null;
  }

  return {
    kind: send.status,
    channelLabel: connection
      ? channelLabel({ channelId: connection.channelId, channelName: connection.channelName })
      : null,
  };
}

// One serializable snapshot per layout render — badge count and rows from the same DB
// read, so the two can never disagree (ADD D-3). One malformed row degrades in here to
// the generic sentence + subject link (D5); the whole call is the unit the layout
// try/catches, so a fault yields a shell without a bell, never a broken shell.
export async function readBellSnapshot(
  db: ScopedDb,
  ctx: TenantContext,
  options: ReadBellSnapshotOptions,
): Promise<BellSnapshot> {
  const repo = createNotificationsRepo(db, ctx);
  const s = scoped(db, ctx);

  const rows = await repo.listRecentWithReadState(options);
  const badgeCount = await repo.countNewerThanOpened();
  const connection = await createSlackConnectionsRepo(db, ctx).getActiveForOrg();

  const actorIds = [
    ...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null)),
  ];
  const namesById = new Map<string, string>();
  if (actorIds.length > 0) {
    const named = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, actorIds));
    for (const row of named) {
      namesById.set(row.id, row.name);
    }
  }

  const findingIds = [
    ...new Set(rows.filter((row) => row.subjectKind === "finding").map((row) => row.subjectId)),
  ];
  const findingTextRowsById = new Map<string, { headline: string; context: unknown }>();
  if (findingIds.length > 0) {
    const findingRows = await db
      .select({ id: findings.id, headline: findings.headline, context: findings.context })
      .from(findings)
      .where(s.owned(findings, inArray(findings.id, findingIds)))
      .limit(findingIds.length);
    for (const row of findingRows) {
      findingTextRowsById.set(row.id, { headline: row.headline, context: row.context });
    }
  }

  const seams: RenderSeams = { namesById, findingTextRowsById, organizationName: ctx.organizationName };

  const snapshotRows: BellSnapshotRow[] = rows.map((row) => {
    let sentence: string;
    try {
      sentence = sentenceOf(row, seams);
    } catch {
      // D5: one row that cannot render costs its own sentence and nothing else.
      sentence = genericNotificationSentence();
    }

    return {
      id: row.id,
      sentence,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      unread: row.unread,
      createdAtIso: row.createdAt.toISOString(),
      chip: chipOf(row, connection),
    };
  });

  return {
    badgeCount,
    rows: snapshotRows,
    emptyVariant:
      snapshotRows.length > 0
        ? null
        : await emptyVariantOf(db, ctx, connection !== null && isDeliveryTarget(connection)),
  };
}

// The setup read runs only when rows are zero (ADD D-3); when it cannot be answered the
// safe default is "nothing_new", which never overpromises.
async function emptyVariantOf(
  db: ScopedDb,
  ctx: TenantContext,
  hasDeliveryTarget: boolean,
): Promise<NotificationEmptyVariant> {
  try {
    const s = scoped(db, ctx);
    const [ran] = await db
      .select({ id: analysisRuns.id })
      .from(analysisRuns)
      .where(s.org(analysisRuns))
      .limit(1);

    if (!ran) {
      return "pre_setup";
    }

    return hasDeliveryTarget ? "nothing_new" : "nothing_new_no_slack";
  } catch {
    return "nothing_new";
  }
}
