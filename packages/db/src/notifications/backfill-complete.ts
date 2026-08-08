import { randomUUID } from "node:crypto";

import { buildBackfillCompleteDedupKey } from "@growthmind/shared";

import type { ScopedExecutor } from "../repositories/types";
import { emitNotification } from "./emit";

export interface EmitBackfillCompleteInput {
  readonly connectionId: string;
  readonly sessionsTouched: number;
  readonly eventsPersisted: number;
}

// The one emitter that lives outside this package (ADD §4.2): the poll loop computes the
// drained fact, so this narrow seam is exported instead of `emitNotification` itself. The
// counts are frozen at emit because a count resolved at render would describe a different
// moment; the receipt is quiet/digest, so the weekly summary owns delivery (D-7).
export async function emitBackfillComplete(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitBackfillCompleteInput,
): Promise<void> {
  await emitNotification(db, organizationId, {
    type: "backfill_complete",
    subjectKind: "source_connection",
    subjectId: input.connectionId,
    actorUserId: null,
    payload: {
      type: "backfill_complete",
      v: 1,
      sessionsTouched: input.sessionsTouched,
      eventsPersisted: input.eventsPersisted,
    },
    dedupKey: buildBackfillCompleteDedupKey(randomUUID()),
    slack: { kind: "quiet_digest" },
  });
}
