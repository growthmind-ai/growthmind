import { buildChangeReadoutDedupKey } from "@growthmind/shared";

import type { ScopedExecutor } from "../repositories/types";
import { emitNotification } from "./emit";
import { readShippedChangeClock } from "./shipped-clock";

export interface EmitChangeReadoutInput {
  readonly changeId: string;
}

// Owed and never quiet_digest: the weekly gather only sweeps rows quiet for the digest reason,
// so the answer is delivered once and cannot come back inside next week's summary.
export async function emitChangeReadout(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitChangeReadoutInput,
): Promise<{ readonly emitted: boolean }> {
  const readoutDueAt = await readShippedChangeClock(db, organizationId, input.changeId);

  if (readoutDueAt === null) return { emitted: false };

  return emitNotification(db, organizationId, {
    type: "change_readout",
    subjectKind: "shipped_change",
    subjectId: input.changeId,
    actorUserId: null,
    payload: { type: "change_readout", v: 1 },
    dedupKey: buildChangeReadoutDedupKey(input.changeId, readoutDueAt),
    slack: { kind: "owed" },
  });
}
