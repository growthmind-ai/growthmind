import type {
  NotificationEmptyVariant,
  NotificationSubjectKind,
  TenantContext,
} from "@growthmind/shared";

import type { ScopedDb } from "../repositories/types";

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

// One serializable snapshot per layout render — badge count and rows from the same DB
// read, so the two can never disagree (ADD D-3). One malformed row degrades in here to
// the generic sentence + subject link (D5); the whole call is the unit the layout
// try/catches, so a fault yields a shell without a bell, never a broken shell.
export async function readBellSnapshot(
  _db: ScopedDb,
  _ctx: TenantContext,
  _options: ReadBellSnapshotOptions,
): Promise<BellSnapshot> {
  throw new Error("O-051 W1+: not implemented");
}
