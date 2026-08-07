// The bell snapshot and its client DTO (ADD §6, UX §4): one serializable snapshot per
// layout render, degraded per row, mapped to strings the client never recomputes. RED in
// Wave 0 against the throwing service and mapper stubs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { genericNotificationSentence } from "@growthmind/core";
import { readBellSnapshot, type BellSnapshot } from "@growthmind/db";
import {
  createTestDb,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "@growthmind/db/testing";
import { FAILED_CHIP_LABEL, QUIET_NO_CHANNEL_CHIP_LABEL, sentChipLabel } from "@growthmind/shared";

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
