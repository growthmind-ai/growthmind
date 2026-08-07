import type { ScopedDb } from "@growthmind/db";

import type { TaskLogger } from "../task-logger";

export interface NotificationDigestDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

// Gathers and emits; it posts nothing itself. The Slack leg is the ordinary owed arm, so
// the digest adds no Slack call site — a summary posted directly would be the fifth
// bespoke one the seam register exists to forbid. An empty week emits no notification row
// at all, not a row saying nothing happened.
export function runNotificationDigest(_deps: NotificationDigestDeps): Promise<void> {
  throw new Error("O-051 job 2: not implemented");
}
