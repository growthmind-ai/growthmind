import type { ScopedDb } from "@growthmind/db";

import type { TaskLogger } from "../task-logger";

export interface NotificationRescueDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

// One dispatch job per unsettled notification inside the window. Idempotent by
// construction: every job it queues is a dispatch job whose settled check and claim lease
// already make a duplicate free.
export function runNotificationRescue(
  _payload: unknown,
  _deps: NotificationRescueDeps,
): Promise<void> {
  throw new Error("O-051 job 2: not implemented");
}
