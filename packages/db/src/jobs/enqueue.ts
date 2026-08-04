import { logger } from "@growthmind/shared";
import { sql } from "drizzle-orm";

import { describeDriverError } from "../repositories/driver-error";
import type { ScopedExecutor } from "../repositories/types";

// Graphile Worker owns `graphile_worker.add_job`, and it only exists once the worker has
// booted against this database at least once. On a fresh clone the web app is up before the
// worker has ever run, so this must be survivable rather than fatal.
export async function enqueueJob(
  db: ScopedExecutor,
  input: { readonly task: string; readonly payload: unknown; readonly jobKey: string },
): Promise<boolean> {
  try {
    await db.execute(
      sql`select graphile_worker.add_job(${input.task}, payload := ${JSON.stringify(input.payload)}::json, job_key := ${input.jobKey}, job_key_mode := 'replace')`,
    );
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
