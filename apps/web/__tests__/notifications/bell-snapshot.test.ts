// The bell snapshot and its client DTO (ADD §6, UX §4): one serializable snapshot per
// layout render, degraded per row, mapped to strings the client never recomputes. Job 1's
// blocks pin the shipped read; the job-2 block at the end is RED in Wave 0 — the chip
// carrying its stored quiet reason, the historical channel label, and the muted badge.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { genericNotificationSentence } from "@growthmind/core";
import { readBellSnapshot, schema, type BellSnapshot } from "@growthmind/db";
import {
  createTestDb,
  PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
  PLACEHOLDER_CREDENTIAL_KEY_ID,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "@growthmind/db/testing";
import {
  digestChipLabel,
  FAILED_CHIP_LABEL,
  NOTIFICATION_SEND_NO_TARGET,
  QUIET_DIGEST_OFF_CHIP_LABEL,
  QUIET_NO_CHANNEL_CHIP_LABEL,
  QUIET_UNKNOWN_REASON_CHIP_LABEL,
  sentChipLabel,
  type DigestCadence,
} from "@growthmind/shared";

import { readSourceUnderConstruction } from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  bellChipViewModel,
  bellTimeLabel,
  subjectHrefFor,
  toBellViewModel,
} from "../../lib/notifications/bell";

const PREFIX = "o051-snapshot-";
const LAYOUT_OWNER = "O-051 task 3.3 (apps/web/app/(app)/layout.tsx, ADD D-3)";

const OPTIONS = { limit: 20, windowDays: 30 } as const;

// 60s: a cold PGlite boot blows bun's 5s default.
const COLD_BOOT_BUDGET_MS = 60_000;

let db: TestDb;
let close: () => Promise<void>;
let orgCount = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await close();
});

async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
  orgCount += 1;
  return seedOrgWithOwner(db, {
    orgName: `${PREFIX}org-${label}`,
    userName: `${PREFIX}user-${label}`,
    email: `${PREFIX}${label}-${String(orgCount)}@example.com`,
  });
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function everyLeafIsWireSafe(value: unknown, path: string, offenders: string[]): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      everyLeafIsWireSafe(item, `${path}[${String(index)}]`, offenders),
    );
    return;
  }
  if (kind === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      everyLeafIsWireSafe(child, `${path}.${key}`, offenders);
    }
    return;
  }
  offenders.push(`${path} is ${kind}`);
}

describe("the snapshot the layout serializes (server truth, one read)", () => {
  test("every leaf is a string, number, boolean or null — boundary-suite compatible", async () => {
    const org = await seedOrg("wire-safe");
    const seeded = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      actorUserId: org.userId,
      createdAt: minutesFromNow(-30),
    });
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: seeded.id,
      status: "sent",
      target: "C0SNAP",
      messageRef: "1785481299.000400",
      sentAt: minutesFromNow(-29),
    });

    const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);
    const vm = toBellViewModel(snapshot, new Date());

    const offenders: string[] = [];
    everyLeafIsWireSafe(vm, "bell", offenders);
    expect(offenders).toEqual([]);

    // A functions-free object round-trips losslessly; the boundary suite's real check.
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm as unknown as Record<string, unknown>);
    expect(vm.rows.length).toBeGreaterThan(0);
  });

  test("one malformed payload row degrades to the generic sentence + subject link while siblings are untouched (D5)", async () => {
    const org = await seedOrg("degrade");
    const sound = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      actorUserId: org.userId,
      createdAt: minutesFromNow(-10),
    });
    const malformed = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      subjectKind: "agent_key",
      subjectId: "subject-under-the-malformed-row",
      // A shape no schema of ours ever declared: production holds every shape ever written.
      payload: { v: 99, carried: "an unknown future arm" },
      createdAt: minutesFromNow(-5),
    });

    const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);
    expect(snapshot.rows).toHaveLength(2);

    const degraded = snapshot.rows.find((row) => row.id === malformed.id);
    if (!degraded) throw new Error("the malformed row was dropped instead of degraded");
    expect(degraded.sentence).toBe(genericNotificationSentence());
    expect(degraded.subjectKind).toBe("agent_key");
    expect(degraded.subjectId).toBe("subject-under-the-malformed-row");

    const sibling = snapshot.rows.find((row) => row.id === sound.id);
    if (!sibling) throw new Error("the sound sibling went missing");
    expect(sibling.sentence).not.toBe(genericNotificationSentence());
    expect(sibling.sentence.length).toBeGreaterThan(0);
  });

  test("rows come newest-first, capped at 20, floored at 30 days", async () => {
    const org = await seedOrg("window");

    const aged = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
    });
    const seededIds: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const seeded = await seedNotification(db, {
        organizationId: org.organizationId,
        createdAt: minutesFromNow(-(21 - i)),
      });
      seededIds.push(seeded.id);
    }

    const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);
    expect(snapshot.rows).toHaveLength(20);

    const returned = snapshot.rows.map((row) => row.id);
    expect(returned).not.toContain(aged.id);
    // The oldest in-window row is the one the 20 cap drops.
    expect(returned).not.toContain(seededIds[0]);

    const instants = snapshot.rows.map((row) => new Date(row.createdAtIso).getTime());
    const sorted = instants.toSorted((a, b) => b - a);
    expect(instants).toEqual(sorted);
  });

  test("the badge label caps at 9+ while the count stays honest", () => {
    const capped: BellSnapshot = { badgeCount: 12, rows: [], emptyVariant: "nothing_new" };
    const small: BellSnapshot = { badgeCount: 3, rows: [], emptyVariant: "nothing_new" };
    const now = new Date();

    expect(toBellViewModel(capped, now).badgeLabel).toBe("9+");
    expect(toBellViewModel(capped, now).badgeCount).toBe(12);
    expect(toBellViewModel(small, now).badgeLabel).toBe("3");
  });

  test("the layout treats the whole read as one try/catch unit and passes null on a fault — shell intact", () => {
    const layout = readSourceUnderConstruction({
      repoRelativePath: "apps/web/app/(app)/layout.tsx",
      ownedBy: LAYOUT_OWNER,
    });

    const tryBlock = layout.match(/try\s*\{[\s\S]*?\}\s*catch/)?.[0] ?? "";
    expect(tryBlock).toMatch(/[Ss]napshot/);
    expect(layout).toContain("null");
  });
});

describe("the client DTO mappers (server-built strings, no client clock)", () => {
  const NOW = new Date("2026-08-07T12:00:00.000Z");

  function secondsAgo(seconds: number): string {
    return new Date(NOW.getTime() - seconds * 1_000).toISOString();
  }

  test("the time-label ladder buckets exactly per UX §4", () => {
    expect(bellTimeLabel(secondsAgo(30), NOW)).toBe("just now");
    expect(bellTimeLabel(secondsAgo(59), NOW)).toBe("just now");
    expect(bellTimeLabel(secondsAgo(60), NOW)).toBe("1m ago");
    expect(bellTimeLabel(secondsAgo(5 * 60), NOW)).toBe("5m ago");
    expect(bellTimeLabel(secondsAgo(59 * 60), NOW)).toBe("59m ago");
    expect(bellTimeLabel(secondsAgo(60 * 60), NOW)).toBe("1h ago");
    expect(bellTimeLabel(secondsAgo(23 * 60 * 60), NOW)).toBe("23h ago");

    // ≥24h on the previous calendar day is "yesterday", not a wrapped hour count.
    expect(bellTimeLabel("2026-08-06T12:00:00.000Z", NOW)).toBe("yesterday");
    expect(bellTimeLabel("2026-08-06T10:00:00.000Z", NOW)).toBe("yesterday");

    // Inside the week: the en-GB short weekday. 2026-08-05 is a Wednesday.
    expect(bellTimeLabel("2026-08-05T09:00:00.000Z", NOW)).toBe("Wed");
    expect(bellTimeLabel("2026-08-01T12:00:00.000Z", NOW)).toBe("Sat");

    // At and past seven days: the dayMonth form, never a stale weekday.
    expect(bellTimeLabel("2026-07-31T12:00:00.000Z", NOW)).toBe("31 Jul");
    expect(bellTimeLabel("2026-07-29T12:00:00.000Z", NOW)).toBe("29 Jul");
  });

  test("the subject-href map is total — an unknown kind routes home, never a 404", () => {
    expect(subjectHrefFor("finding").startsWith("/findings")).toBe(true);

    const agentHref = subjectHrefFor("agent_key");
    expect(agentHref.startsWith("/")).toBe(true);
    expect(agentHref).not.toBe("/");

    expect(subjectHrefFor("a-kind-minted-after-this-build")).toBe("/");
  });

  test("chip view models: sent is inert, failed and quiet navigate to the repair", () => {
    const sent = bellChipViewModel({ kind: "sent", channelLabel: "growth" });
    expect(sent.label).toBe(sentChipLabel("growth"));
    expect(sent.href).toBeNull();

    // The null channel label never renders "#null" — the shared fallback sentence does.
    const sentUnnamed = bellChipViewModel({ kind: "sent", channelLabel: null });
    expect(sentUnnamed.label).toBe(sentChipLabel(null));

    const failed = bellChipViewModel({ kind: "failed", channelLabel: null });
    expect(failed.label).toBe(FAILED_CHIP_LABEL);
    expect(failed.href?.startsWith("/")).toBe(true);

    const quiet = bellChipViewModel({ kind: "quiet", channelLabel: null });
    expect(quiet.label).toBe(QUIET_NO_CHANNEL_CHIP_LABEL);
    expect(quiet.href?.startsWith("/")).toBe(true);
  });
});

async function setDigestSettings(organizationId: string, cadence: DigestCadence): Promise<void> {
  await db
    .insert(schema.notificationSettings)
    .values({ organizationId, digestCadence: cadence, digestDay: "monday" });
}

async function seedQuietReceipt(
  org: SeededOrgWithOwner,
  quietReason: string,
): Promise<{ readonly id: string }> {
  const seeded = await seedNotification(db, {
    organizationId: org.organizationId,
    type: "backfill_complete",
    subjectKind: "source_connection",
    subjectId: randomUUID(),
    payload: { type: "backfill_complete", v: 1, sessionsTouched: 4, eventsPersisted: 60 },
    createdAt: minutesFromNow(-15),
  });
  await seedNotificationSend(db, {
    organizationId: org.organizationId,
    notificationId: seeded.id,
    status: "quiet",
    quietReason,
    target: "none",
  });
  return seeded;
}

async function seedLabelledSentReceipt(
  org: SeededOrgWithOwner,
  target: string,
  channelLabel: string,
): Promise<{ readonly id: string }> {
  const seeded = await seedNotification(db, {
    organizationId: org.organizationId,
    type: "keys_revoked",
    actorUserId: org.userId,
    createdAt: minutesFromNow(-10),
  });
  await db.insert(schema.notificationSends).values({
    organizationId: org.organizationId,
    notificationId: seeded.id,
    channel: "slack",
    target,
    status: "sent",
    channelLabel,
    messageRef: "1785481299.000501",
    sentAt: minutesFromNow(-9),
  });
  return seeded;
}

async function seedActiveConnection(
  org: SeededOrgWithOwner,
  channelId: string,
  channelName: string,
): Promise<void> {
  await db.insert(schema.slackConnections).values({
    id: randomUUID(),
    organizationId: org.organizationId,
    channelId,
    channelName,
    credentialCiphertext: PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
    credentialKeyId: PLACEHOLDER_CREDENTIAL_KEY_ID,
    isActive: true,
    connectedAt: new Date(),
  });
}

async function chipLabelFor(org: SeededOrgWithOwner, notificationId: string): Promise<string> {
  const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);
  const vm = toBellViewModel(snapshot, new Date());
  const row = vm.rows.find((candidate) => candidate.id === notificationId);
  if (!row) throw new Error("the seeded notification fell out of the snapshot");
  if (!row.chip) throw new Error("the seeded receipt rendered no chip at all");
  return row.chip.label;
}

describe("job 2 — the chip carries its stored reason and the badge counts what the viewer sees (RED in Wave 0)", () => {
  test("a quiet digest row renders the org's own summary day, never the no-Slack chip (UX D-A)", async () => {
    const org = await seedOrg("digest-chip");
    await setDigestSettings(org.organizationId, "weekly");
    const seeded = await seedQuietReceipt(org, "digest");

    const label = await chipLabelFor(org, seeded.id);

    // "not sent — Slack isn't connected" here would be false, pointing at a repair that
    // does not exist — the exact defect the UX spec names.
    expect(label).not.toBe(QUIET_NO_CHANNEL_CHIP_LABEL);
    expect(label).toBe(digestChipLabel("Monday"));
  });

  test("cadence off renders the summary-off sentence, never a summary that will not arrive (UX C-13)", async () => {
    const org = await seedOrg("digest-chip-off");
    await setDigestSettings(org.organizationId, "off");
    const seeded = await seedQuietReceipt(org, "digest");

    expect(await chipLabelFor(org, seeded.id)).toBe(QUIET_DIGEST_OFF_CHIP_LABEL);
  });

  test("a quiet no_channel row still renders the shipped no-Slack chip", async () => {
    const org = await seedOrg("no-channel-chip");
    const seeded = await seedQuietReceipt(org, "no_channel");

    expect(await chipLabelFor(org, seeded.id)).toBe(QUIET_NO_CHANNEL_CHIP_LABEL);
  });

  test("a quiet reason minted after this build degrades to the shipped not-sent chip (D5)", async () => {
    const org = await seedOrg("unknown-reason");
    const seeded = await seedQuietReceipt(org, "a-reason-minted-after-this-build");

    expect(await chipLabelFor(org, seeded.id)).toBe(QUIET_UNKNOWN_REASON_CHIP_LABEL);
  });

  test("a repointed connection does not relabel a historical chip (AC-8)", async () => {
    const org = await seedOrg("repointed");

    // The org now posts to #ops, but this receipt happened in #growth and says so — the
    // label was written beside the target at send time and the send row is the source.
    await seedActiveConnection(org, "C0AFTER01", "ops");
    const seeded = await seedLabelledSentReceipt(org, "C0BEFORE1", "growth");

    expect(await chipLabelFor(org, seeded.id)).toBe(sentChipLabel("growth"));
  });

  test("no active connection at all keeps the historical label (AC-9)", async () => {
    const org = await seedOrg("disconnected-label");
    const seeded = await seedLabelledSentReceipt(org, "C0BEFORE2", "growth");

    expect(await chipLabelFor(org, seeded.id)).toBe(sentChipLabel("growth"));
  });

  test("a muted class produces neither badge nor row, and the empty state names the mute (UX D-B)", async () => {
    const org = await seedOrg("muted-badge");
    for (let index = 0; index < 2; index += 1) {
      await seedNotification(db, {
        organizationId: org.organizationId,
        type: "agent_first_contact",
        subjectKind: "agent_key",
        subjectId: randomUUID(),
        createdAt: minutesFromNow(-5 - index),
      });
    }
    await db.insert(schema.notificationMutes).values({
      organizationId: org.organizationId,
      userId: org.userId,
      class: "work",
    });

    const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);

    // The badge is measured over the population the viewer can see, or it opens onto
    // nothing — the C-5 disagreement made routine by this sprint's own feature.
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.badgeCount).toBe(0);
    expect(snapshot.emptyVariant).toBe("muted_by_you");
  });

  test("an org with genuinely nothing to show never claims a mute hid something", async () => {
    const org = await seedOrg("muted-but-empty");
    await db.insert(schema.notificationMutes).values({
      organizationId: org.organizationId,
      userId: org.userId,
      class: "record",
    });

    const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.emptyVariant).not.toBe("muted_by_you");
    expect(["pre_setup", "nothing_new", "nothing_new_no_slack"]).toContain(
      snapshot.emptyVariant ?? "",
    );
  });
});

interface ReceiptRowSeed {
  readonly status: "sent" | "failed" | "quiet";
  readonly target: string;
  readonly createdAt: Date;
  readonly quietReason?: string;
  readonly failureReason?: string;
  readonly channelLabel?: string;
  readonly messageRef?: string;
  readonly sentAt?: Date;
}

async function seedReceiptRow(
  org: SeededOrgWithOwner,
  notificationId: string,
  row: ReceiptRowSeed,
): Promise<void> {
  await db.insert(schema.notificationSends).values({
    organizationId: org.organizationId,
    notificationId,
    channel: "slack",
    target: row.target,
    status: row.status,
    quietReason: row.quietReason ?? null,
    failureReason: row.failureReason ?? null,
    channelLabel: row.channelLabel ?? null,
    messageRef: row.messageRef ?? null,
    sentAt: row.sentAt ?? null,
    createdAt: row.createdAt,
  });
}

async function chipOfSeeded(org: SeededOrgWithOwner, notificationId: string) {
  const snapshot = await readBellSnapshot(db, org.ctx, OPTIONS);
  const row = snapshot.rows.find((candidate) => candidate.id === notificationId);
  if (!row) throw new Error("the seeded notification fell out of the snapshot");
  if (!row.chip) throw new Error("the seeded receipts rendered no chip at all");
  return row.chip;
}

// O-051 job 2 regression: chipOf once took the oldest settled row via first-match over a
// createdAt-ascending read, so a rescued notification wore its stranded receipt forever.
describe("the chip is the authoritative receipt across the whole send history (AC-7)", () => {
  test("a rescue leaves both receipts and the chip is the sent one, carrying the send row's stored label", async () => {
    const org = await seedOrg("rescued-chip");
    const seeded = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      actorUserId: org.userId,
      createdAt: minutesFromNow(-30),
    });
    await seedReceiptRow(org, seeded.id, {
      status: "quiet",
      quietReason: "no_channel",
      target: NOTIFICATION_SEND_NO_TARGET,
      createdAt: minutesFromNow(-25),
    });
    await seedReceiptRow(org, seeded.id, {
      status: "sent",
      target: "C0RESCUED1",
      channelLabel: "growth",
      messageRef: "1785481299.000600",
      sentAt: minutesFromNow(-5),
      createdAt: minutesFromNow(-5),
    });

    const chip = await chipOfSeeded(org, seeded.id);
    expect(chip.kind).toBe("sent");
    expect(chip.channelLabel).toBe("growth");
    expect(chip.quietReason ?? null).toBeNull();
    expect(bellChipViewModel(chip).label).toBe(sentChipLabel("growth"));
  });

  test("a failed receipt from before the repair loses to the later sent one", async () => {
    const org = await seedOrg("failed-then-sent");
    const seeded = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      actorUserId: org.userId,
      createdAt: minutesFromNow(-30),
    });
    await seedReceiptRow(org, seeded.id, {
      status: "failed",
      failureReason: "not_authorised",
      target: "C0BROKEN01",
      createdAt: minutesFromNow(-20),
    });
    await seedReceiptRow(org, seeded.id, {
      status: "sent",
      target: "C0REPAIRED",
      channelLabel: "ops",
      messageRef: "1785481299.000601",
      sentAt: minutesFromNow(-4),
      createdAt: minutesFromNow(-4),
    });

    const chip = await chipOfSeeded(org, seeded.id);
    expect(chip.kind).toBe("sent");
    expect(chip.channelLabel).toBe("ops");
  });

  test("receipts of equal rank tie-break newest-first, so the chip names where it went last", async () => {
    const org = await seedOrg("tie-newest");
    const seeded = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      actorUserId: org.userId,
      createdAt: minutesFromNow(-30),
    });
    await seedReceiptRow(org, seeded.id, {
      status: "sent",
      target: "C0FIRST001",
      channelLabel: "first-home",
      messageRef: "1785481299.000602",
      sentAt: minutesFromNow(-15),
      createdAt: minutesFromNow(-15),
    });
    await seedReceiptRow(org, seeded.id, {
      status: "sent",
      target: "C0SECOND01",
      channelLabel: "second-home",
      messageRef: "1785481299.000603",
      sentAt: minutesFromNow(-3),
      createdAt: minutesFromNow(-3),
    });

    const chip = await chipOfSeeded(org, seeded.id);
    expect(chip.kind).toBe("sent");
    expect(chip.channelLabel).toBe("second-home");
  });
});
