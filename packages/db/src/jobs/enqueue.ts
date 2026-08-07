import { logger } from "@growthmind/shared";
import { sql } from "drizzle-orm";

import { inTransaction } from "../repositories/crud";
import { describeDriverError } from "../repositories/driver-error";
import type { ScopedExecutor } from "../repositories/types";

// Graphile Worker owns `graphile_worker.add_job`, and it only exists once the worker has
// booted against this database at least once. On a fresh clone the web app is up before the
// worker has ever run, so this must be survivable rather than fatal.
//
// The nested transaction is what makes "survivable" true for a caller that is already in
// one. Postgres aborts the whole transaction on any failed statement, so catching the error
// in JavaScript leaves the caller holding a transaction that rejects every later write with
// 25P02 — the enqueue looks handled and the writes after it are lost. Nesting emits a
// savepoint, so a missing `graphile_worker` schema rolls back to it and the caller's
// transaction is still usable, which is what lets an emit record its failed receipt beside
// the fact it belongs to.
export async function enqueueJob(
  db: ScopedExecutor,
  input: { readonly task: string; readonly payload: unknown; readonly jobKey: string },
): Promise<boolean> {
  try {
    await inTransaction(db, async (attempt) => {
      await attempt.execute(
        sql`select graphile_worker.add_job(${input.task}, payload := ${JSON.stringify(input.payload)}::json, job_key := ${input.jobKey}, job_key_mode := 'replace')`,
      );
    });
    return true;
  } catch (error) {
    logger.error("enqueue: a job could not be queued", {
      task: input.task,
      jobKey: input.jobKey,
      reason: describeDriverError(error),
    });
    return false;
  }
}
