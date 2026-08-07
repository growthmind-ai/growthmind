import type { BellSnapshot, BellSnapshotChip } from "@growthmind/db";
import type { NotificationEmptyVariant } from "@growthmind/shared";

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

// Total by signature: an unknown kind routes home rather than 404 (ADD §6).
export function subjectHrefFor(_subjectKind: string): string {
  throw new Error("O-051 W1+: not implemented");
}

// Server-built, en-GB pinned, the /channel format.ts ladder — never a client clock.
export function bellTimeLabel(_createdAtIso: string, _now: Date): string {
  throw new Error("O-051 W1+: not implemented");
}

export function bellChipViewModel(_chip: BellSnapshotChip): BellChipViewModel {
  throw new Error("O-051 W1+: not implemented");
}

export function toBellViewModel(_snapshot: BellSnapshot, _now: Date): BellViewModel {
  throw new Error("O-051 W1+: not implemented");
}
