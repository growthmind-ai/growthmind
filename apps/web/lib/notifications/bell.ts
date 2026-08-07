import type { BellSnapshot, BellSnapshotChip } from "@growthmind/db";
import {
  FAILED_CHIP_LABEL,
  quietChipLabel,
  sentChipLabel,
  type NotificationEmptyVariant,
} from "@growthmind/shared";

import { ROUTES } from "../routes";

// Client DTO: strings, booleans and numbers only — it crosses the server→client prop
// boundary, and the client never recomputes any of it (no client clock, no second
// sentence home).
export interface BellChipViewModel {
  readonly kind: "sent" | "digest" | "failed" | "quiet";
  readonly label: string;
  readonly href: string | null;
}

export interface BellRowViewModel {
  readonly id: string;
  readonly sentence: string;
  readonly subjectHref: string;
  readonly timeLabel: string;
  readonly unread: boolean;
  readonly chip: BellChipViewModel | null;
}

export interface BellViewModel {
  readonly badgeCount: number;

  // "9+" past nine; the aria label carries the honest "more than 9 new".
  readonly badgeLabel: string;

  readonly rows: readonly BellRowViewModel[];
  readonly emptyVariant: NotificationEmptyVariant | null;
}

const BADGE_DISPLAY_CAP = 9;

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WEEK_MS = 7 * DAY_MS;

// Total by signature: an unknown kind routes home rather than 404 (ADD §6).
export function subjectHrefFor(subjectKind: string): string {
  switch (subjectKind) {
    case "finding":
      return ROUTES.findings;
    case "agent_key":
      return ROUTES.agent;
    default:
      return "/";
  }
}

// Server-built, en-GB pinned, the /channel format.ts ladder — never a client clock.
export function bellTimeLabel(createdAtIso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(createdAtIso).getTime();

  if (elapsed < MINUTE_MS) {
    return "just now";
  }

  if (elapsed < HOUR_MS) {
    return `${String(Math.floor(elapsed / MINUTE_MS))}m ago`;
  }

  if (elapsed < DAY_MS) {
    return `${String(Math.floor(elapsed / HOUR_MS))}h ago`;
  }

  if (elapsed < 2 * DAY_MS) {
    return "yesterday";
  }

  const at = new Date(createdAtIso);

  if (elapsed < WEEK_MS) {
    return at.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  }

  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function bellChipViewModel(chip: BellSnapshotChip): BellChipViewModel {
  switch (chip.kind) {
    case "sent":
      // Nothing to attend to, so nothing to press.
      return { kind: "sent", label: sentChipLabel(chip.channelLabel), href: null };
    case "failed":
      return { kind: "failed", label: FAILED_CHIP_LABEL, href: ROUTES.settings };
    case "quiet":
      return { kind: "quiet", label: quietChipLabel("no_channel"), href: ROUTES.settings };
  }
}

function badgeLabelOf(count: number): string {
  return count > BADGE_DISPLAY_CAP ? `${String(BADGE_DISPLAY_CAP)}+` : String(count);
}

export function toBellViewModel(snapshot: BellSnapshot, now: Date): BellViewModel {
  return {
    badgeCount: snapshot.badgeCount,
    badgeLabel: badgeLabelOf(snapshot.badgeCount),
    rows: snapshot.rows.map((row) => ({
      id: row.id,
      sentence: row.sentence,
      subjectHref: subjectHrefFor(row.subjectKind),
      timeLabel: bellTimeLabel(row.createdAtIso, now),
      unread: row.unread,
      chip: row.chip === null ? null : bellChipViewModel(row.chip),
    })),
    emptyVariant: snapshot.emptyVariant,
  };
}
