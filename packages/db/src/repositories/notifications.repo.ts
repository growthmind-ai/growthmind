import type {
  NotificationChannel,
  NotificationSendStatus,
  NotificationSubjectKind,
  NotificationType,
  TenantContext,
} from "@growthmind/shared";

import type { ScopedExecutor } from "./types";

export interface NotificationSendFacts {
  readonly channel: NotificationChannel;
  readonly target: string;
  readonly status: NotificationSendStatus;
  readonly quietReason: string | null;
  readonly failureReason: string | null;
  readonly messageRef: string | null;
  readonly sentAt: Date | null;
}

// `payload` stays `unknown` outward: a stored row can carry any shape ever written (D5),
// so the one tolerant parse happens in the consuming service, never on trust of the
// column's declared type.
export interface NotificationWithReadState {
  readonly id: string;
  readonly type: NotificationType;
  readonly subjectKind: NotificationSubjectKind;
  readonly subjectId: string;
  readonly actorUserId: string | null;
  readonly payload: unknown;
  readonly createdAt: Date;
  readonly unread: boolean;
  readonly sends: readonly NotificationSendFacts[];
}

export interface ListRecentOptions {
  readonly limit: number;
  readonly windowDays: number;
}

export interface NotificationsRepo {
  // The read predicate — a reads row exists OR created_at < read_before — is computed in
  // this method's SQL and nowhere else (ADD D-5); `unread` carries it outward.
  listRecentWithReadState(
    options: ListRecentOptions,
  ): Promise<readonly NotificationWithReadState[]>;

  // The badge is deliberately a different fact: created_at > opened_at, ignoring read
  // state. Capped by subquery LIMIT 10 — display caps at 9+, so counting past ten is waste.
  countNewerThanOpened(): Promise<number>;

  stampOpened(): Promise<void>;

  markAllRead(): Promise<void>;

  markRead(notificationId: string): Promise<void>;
}

export function createNotificationsRepo(_db: ScopedExecutor, _ctx: TenantContext): NotificationsRepo {
  return {
    async listRecentWithReadState(): Promise<readonly NotificationWithReadState[]> {
      throw new Error("O-051 W1+: not implemented");
    },

    async countNewerThanOpened(): Promise<number> {
      throw new Error("O-051 W1+: not implemented");
    },

    async stampOpened(): Promise<void> {
      throw new Error("O-051 W1+: not implemented");
    },

    async markAllRead(): Promise<void> {
      throw new Error("O-051 W1+: not implemented");
    },

    async markRead(): Promise<void> {
      throw new Error("O-051 W1+: not implemented");
    },
  };
}
