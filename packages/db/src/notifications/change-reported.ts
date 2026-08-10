import { buildChangeReportedDedupKey } from "@growthmind/shared";

import type { ScopedExecutor } from "../repositories/types";
import { emitNotification } from "./emit";
import { readShippedChangeClock } from "./shipped-clock";

export interface EmitChangeReportedInput {
  readonly changeId: string;
}

// The change id and its clock are the dedup key, so a re-report inside the window keys into the
// acknowledgement that already exists and cannot promise a second date.
export async function emitChangeReported(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitChangeReportedInput,
): Promise<{ readonly emitted: boolean }> {
  const readoutDueAt = await readShippedChangeClock(db, organizationId, input.changeId);

  if (readoutDueAt === null) return { emitted: false };

  return emitNotification(db, organizationId, {
    type: "change_reported",
    subjectKind: "shipped_change",
    subjectId: input.changeId,
    actorUserId: null,
    payload: { type: "change_reported", v: 1 },
    dedupKey: buildChangeReportedDedupKey(input.changeId, readoutDueAt),
    slack: { kind: "owed" },
  });
}
