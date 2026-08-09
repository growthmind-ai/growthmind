import type { ScopedDb } from "@growthmind/db";
import { createShippedChangesService, createShippedChangeVerdictsRepo } from "@growthmind/db";
import {
  SYSTEM_ACTOR,
  listDueShippedReadouts,
  listLapsedShippedChanges,
  systemContextFor,
  type ScheduledShippedChange,
} from "@growthmind/db/system";

import { isolated, type TaskLogger } from "../task-logger";

export interface ShippedReadoutTickDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

function contextFor(change: ScheduledShippedChange) {
  return systemContextFor(SYSTEM_ACTOR.SHIPPED_READOUT, change);
}

// The transition and the emit commit together inside the service, so a crash before commit
// leaves nothing and the next hourly run retries. It posts nothing itself: the answer rides
// the notification spine, which is why this file holds no Slack seam (ADD Decision 1).
async function readOut(deps: ShippedReadoutTickDeps, change: ScheduledShippedChange, at: Date) {
  const changes = createShippedChangesService(deps.db, contextFor(change));

  // A change whose project is gone has no corpus to answer from, and going silent would leave
  // the row reported forever — the one terminal state that records exactly this (D8).
  if (change.projectId === null) {
    await changes.abandon({ changeId: change.changeId, reason: "project_gone", at });
    return;
  }

  await changes.recordReadout({ changeId: change.changeId, readOutAt: at });
}

// A founder who never answers has told us something too, and this is where that is recorded.
// No notification: the lapse is not news, and they already have the readout.
async function lapse(deps: ShippedReadoutTickDeps, change: ScheduledShippedChange, at: Date) {
  await createShippedChangeVerdictsRepo(deps.db, contextFor(change)).recordVerdict({
    changeId: change.changeId,
    verdict: "no_verdict_given",
    recordedAt: at,
  });
}

export async function runShippedReadoutTick(deps: ShippedReadoutTickDeps): Promise<void> {
  const at = deps.now();

  const due = await listDueShippedReadouts(deps.db, at);

  for (const change of due) {
    // Per row, so one organization's fault cannot starve the rest of the tick (D8).
    await isolated(
      deps.logger,
      `shipped readout: change ${change.changeId} could not be read out this run`,
      () => readOut(deps, change, at),
    );
  }

  // After the readout pass, so a row read out this run is measured from the instant it was
  // actually read out rather than from a window that had not started when the scan ran.
  const lapsed = await listLapsedShippedChanges(deps.db, at);

  for (const change of lapsed) {
    await isolated(
      deps.logger,
      `shipped readout: change ${change.changeId} could not be closed as unanswered this run`,
      () => lapse(deps, change, at),
    );
  }

  deps.logger.info(
    `shipped readout: ${String(due.length)} changes were due and ${String(lapsed.length)} verdict windows had lapsed`,
  );
}
