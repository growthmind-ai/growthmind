import {
  agentFirstContactSentence,
  ANALYSIS_FAILING_RUN_COUNT,
  analysisFailingSentence,
  authoritativeSlackReceipt,
  backfillCompleteSentence,
  digestLeadSentence,
  findingDeliveredSentence,
  genericNotificationSentence,
  keyCreatedSentence,
  keysRevokedSentence,
  slackDisconnectedSentence,
} from "@growthmind/core";
import {
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_TYPES,
  parseNotificationPayload,
  type DigestCadence,
  type NotificationEmptyVariant,
  type NotificationSubjectKind,
  type PostFailureCode,
  type TenantContext,
  type Weekday,
} from "@growthmind/shared";
import { eq, inArray } from "drizzle-orm";

import { readFindingText } from "../repositories/finding-text";
import { createNotificationMutesRepo } from "../repositories/notification-mutes.repo";
import { createNotificationSettingsRepo } from "../repositories/notification-settings.repo";
import {
  createNotificationsRepo,
  type NotificationsRepo,
  type NotificationSendFacts,
  type NotificationWithReadState,
} from "../repositories/notifications.repo";
import { scoped } from "../repositories/scope";
import { toSlackConnectionSummary } from "../repositories/slack-connections.repo";
import type { ScopedDb } from "../repositories/types";
import { analysisRuns } from "../schema/analysis-runs";
import { user } from "../schema/auth";
import { findings } from "../schema/findings";
import { slackConnections } from "../schema/slack-connections";
import { isDeliveryTarget } from "./delivery-channel-guard";
import { findProjectNameForDispatch } from "./notification-dispatch.service";

export interface BellSnapshotChip {
  readonly kind: "sent" | "failed" | "quiet";

  // Both come off the send row, written beside the target at send time (AC-8, AC-9): a
  // repoint, disconnect or settings change never relabels a receipt that already happened.
  // Optional so job 1's reason-less chip literals stay valid; this read always sets it.
  readonly channelLabel: string | null;
  readonly quietReason?: string | null;
}

export interface BellSnapshotDigest {
  readonly cadence: DigestCadence;
  readonly day: Weekday;
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

  // The org's digest setting at read time: the quiet-digest chip names its day from this,
  // never from a stored sentence (ADD D-5a). Optional so a rows-only literal stays valid.
  readonly digest?: BellSnapshotDigest;

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
  readonly projectNamesById: ReadonlyMap<string, string>;
  readonly organizationName: string;

  // The connection's stored code, dispatch's own source — never the vendor's message.
  readonly healthReasonCode: PostFailureCode | null;
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
    case "key_created": {
      const createdByName =
        row.actorUserId === null ? null : (seams.namesById.get(row.actorUserId) ?? null);

      return keyCreatedSentence({ createdByName });
    }
    case "backfill_complete":
      return backfillCompleteSentence({
        sessionsTouched: parsed.payload.sessionsTouched,
        eventsPersisted: parsed.payload.eventsPersisted,
      });
    case "slack_disconnected":
      return slackDisconnectedSentence(seams.healthReasonCode);
    case "analysis_failing": {
      const projectName = seams.projectNamesById.get(row.subjectId);

      // A deleted project degrades to the generic sentence, the dispatch arm's rule (D5).
      return projectName === undefined
        ? genericNotificationSentence()
        : analysisFailingSentence({
            failed: ANALYSIS_FAILING_RUN_COUNT,
            of: ANALYSIS_FAILING_RUN_COUNT,
            projectName,
          });
    }
    case "digest":
      return digestLeadSentence(parsed.payload.notificationIds.length, parsed.payload.totalCount);
  }
}

function chipOf(row: NotificationWithReadState): BellSnapshotChip | null {
  // The authoritative receipt, not the oldest one: a rescued notification holds both the
  // quiet row from when there was no channel and the sent row from after the repair, and
  // the first-match read told the reader forever that it was never sent.
  const send = authoritativeSlackReceipt(
    row.sends.filter((candidate) => candidate.channel === "slack"),
  ) as (NotificationSendFacts & { status: BellSnapshotChip["kind"] }) | null;

  // No receipt yet means the dispatch job still owns the outcome — no chip beats a
  // guessed one. A `pending` row is that same state with a row attached.
  if (!send) {
    return null;
  }

  return { kind: send.status, channelLabel: send.channelLabel, quietReason: send.quietReason };
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

  // One computed value into both reads (ADD D-5b): the list and the badge filter the same
  // population, so the badge can never count a row the popover will not show.
  const mutedSet = new Set<string>(await createNotificationMutesRepo(db, ctx).listMutedClasses());
  const hiddenTypes = NOTIFICATION_TYPES.filter((type) =>
    mutedSet.has(NOTIFICATION_CLASS_BY_TYPE[type]),
  );

  const rows = await repo.listRecentWithReadState({ ...options, hiddenTypes });

  const badgeCount = await repo.countNewerThanOpened({
    windowDays: options.windowDays,
    hiddenTypes,
  });

  const settings = await createNotificationSettingsRepo(db, ctx).read();

  // The full row, dispatch's own read: the summary answers the empty variant's setup
  // check, and the stored health code feeds the slack_disconnected sentence.
  const [connectionRow] = await db
    .select()
    .from(slackConnections)
    .where(s.owned(slackConnections, eq(slackConnections.isActive, true)))
    .limit(1);
  const connection = connectionRow ? toSlackConnectionSummary(connectionRow) : null;

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

  const projectIds = [
    ...new Set(rows.filter((row) => row.type === "analysis_failing").map((row) => row.subjectId)),
  ];
  const projectNamesById = new Map<string, string>();
  await Promise.all(
    projectIds.map(async (projectId) => {
      const name = await findProjectNameForDispatch(db, ctx, projectId);
      if (name !== null) {
        projectNamesById.set(projectId, name);
      }
    }),
  );

  const seams: RenderSeams = {
    namesById,
    findingTextRowsById,
    projectNamesById,
    organizationName: ctx.organizationName,
    healthReasonCode: connectionRow?.healthReasonCode ?? null,
  };

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
      chip: chipOf(row),
    };
  });

  return {
    badgeCount,
    rows: snapshotRows,
    digest: { cadence: settings.digestCadence, day: settings.digestDay },
    emptyVariant:
      snapshotRows.length > 0
        ? null
        : await emptyVariantOf(db, ctx, {
            repo,
            windowDays: options.windowDays,
            hiddenAnything: hiddenTypes.length > 0,
            hasDeliveryTarget: connection !== null && isDeliveryTarget(connection),
          }),
  };
}

interface EmptyVariantInput {
  readonly repo: NotificationsRepo;
  readonly windowDays: number;
  readonly hiddenAnything: boolean;
  readonly hasDeliveryTarget: boolean;
}

// The setup read runs only when rows are zero (ADD D-3); when it cannot be answered the
// safe default is "nothing_new", which never overpromises.
async function emptyVariantOf(
  db: ScopedDb,
  ctx: TenantContext,
  input: EmptyVariantInput,
): Promise<NotificationEmptyVariant> {
  try {
    // Named only when the unfiltered bell would have had rows (UX C-11): an empty week is
    // never blamed on a mute.
    if (input.hiddenAnything) {
      const unfiltered = await input.repo.listRecentWithReadState({
        limit: 1,
        windowDays: input.windowDays,
      });

      if (unfiltered.length > 0) {
        return "muted_by_you";
      }
    }

    const s = scoped(db, ctx);
    const [ran] = await db
      .select({ id: analysisRuns.id })
      .from(analysisRuns)
      .where(s.org(analysisRuns))
      .limit(1);

    if (!ran) {
      return "pre_setup";
    }

    return input.hasDeliveryTarget ? "nothing_new" : "nothing_new_no_slack";
  } catch {
    return "nothing_new";
  }
}
