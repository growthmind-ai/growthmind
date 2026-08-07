import type {
  NotificationPayload,
  NotificationSubjectKind,
  NotificationType,
} from "@growthmind/shared";

import type { ScopedExecutor } from "../repositories/types";

// The Slack leg is resolved at emit time (ADD D-1): "copied" records a post that already
// happened; "owed" resolves the org's delivery target inside the caller's transaction —
// no connection writes the quiet receipt, a connection queues the dispatch job, and an
// enqueue fault writes the failed receipt, so a committed notification can never exist
// without its Slack receipt.
export type EmitNotificationSlack =
  | {
      readonly kind: "copied";
      readonly channelId: string;
      readonly messageRef: string | null;
      readonly sentAt: Date;
    }
  | { readonly kind: "owed" };

export interface EmitNotificationInput {
  readonly type: NotificationType;
  readonly subjectKind: NotificationSubjectKind;
  readonly subjectId: string;

  // A member user id or null — never a machine principal (the FK enforces it).
  readonly actorUserId: string | null;

  readonly payload: NotificationPayload;

  // From the dedup builders only; no display string can enter a key by signature.
  readonly dedupKey: string;

  readonly slack: EmitNotificationSlack;
}

// Module-internal to @growthmind/db, never exported from the barrel: every job-1 emitter
// lives inside this package, and `organizationId` is the one sanctioned exception to "no
// repo method accepts an org id" — both callers derive it from a DB-returned row.
// `db` is the CALLER's transaction executor; emit never opens a transaction of its own.
export async function emitNotification(
  _db: ScopedExecutor,
  _organizationId: string,
  _input: EmitNotificationInput,
): Promise<{ readonly emitted: boolean }> {
  throw new Error("O-051 W1+: not implemented");
}
