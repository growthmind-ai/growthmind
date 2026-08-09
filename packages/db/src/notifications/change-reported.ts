import { buildChangeReportedDedupKey } from "@growthmind/shared";

import type { ScopedExecutor } from "../repositories/types";
import { emitNotification } from "./emit";

export interface EmitChangeReportedInput {
  readonly changeId: string;
}

// The change row's own id is the dedup key, so a re-report keys into the acknowledgement that
// already exists and cannot promise a second date.
export async function emitChangeReported(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitChangeReportedInput,
): Promise<void> {
  await emitNotification(db, organizationId, {
    type: "change_reported",
    subjectKind: "shipped_change",
    subjectId: input.changeId,
    actorUserId: null,
    payload: { type: "change_reported", v: 1 },
    dedupKey: buildChangeReportedDedupKey(input.changeId),
    slack: { kind: "owed" },
  });
}
