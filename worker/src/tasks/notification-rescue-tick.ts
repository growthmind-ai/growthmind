import type { ScopedDb } from "@growthmind/db";

import type { TaskLogger } from "../task-logger";

export interface NotificationRescueTickDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

// The producer for the receipts no write will ever follow: a web-only boot records
// `queue_unavailable` precisely when nobody is performing anything, so no reconnect and no
// health recovery can reach it. Fans out one rescue job per org with Slack connected,
// which collapses on the same job key as any rescue a connection write already queued.
export function runNotificationRescueTick(_deps: NotificationRescueTickDeps): Promise<void> {
  throw new Error("O-051 job 2: not implemented");
}
