import { sql } from "drizzle-orm";

import type { TestDb } from "./db";

export interface CapturedJob {
  readonly task: string;
  readonly payload: unknown;
  readonly jobKey: string | null;
  readonly jobKeyMode: string | null;

  // Null when the caller left the cap to the runner's default; only the dispatch enqueue
  // states one (ADD D-2), and __tests__/jobs/enqueue.test.ts is what reads this.
  readonly maxAttempts: number | null;
}

interface CapturedJobRow {
  readonly task: string;
  readonly payload: unknown;
  readonly job_key: string | null;
  readonly job_key_mode: string | null;
  readonly max_attempts: number | null;
}

// The embedded test database has no graphile_worker schema, so `enqueueJob` returning
// false is the DEFAULT fixture — convenient for the queue_unavailable branch. Installing
// this stub makes the queued-job path assertable instead: a capture table stands in for
// the real jobs table, and `add_job` accepts the same named arguments `enqueueJob` binds.
export async function stubGraphileAddJob(db: TestDb): Promise<void> {
  await db.execute(sql`create schema if not exists graphile_worker`);

  await db.execute(sql`
    create table if not exists graphile_worker.captured_jobs (
      id integer generated always as identity primary key,
      task text not null,
      payload json,
      job_key text unique,
      job_key_mode text,
      max_attempts integer
    )
  `);

  // Language sql, not plpgsql: the parameters must keep the names the caller binds
  // (payload, job_key, job_key_mode, max_attempts), and in a sql function those never
  // collide with the insert's column names. The upsert mirrors job_key_mode := 'replace'.
  await db.execute(sql`
    create or replace function graphile_worker.add_job(
      identifier text,
      payload json default null,
      job_key text default null,
      job_key_mode text default 'replace',
      max_attempts integer default null
    ) returns void language sql as $body$
      insert into graphile_worker.captured_jobs (task, payload, job_key, job_key_mode, max_attempts)
      values (identifier, payload, job_key, job_key_mode, max_attempts)
      on conflict (job_key) do update
        set task = excluded.task,
            payload = excluded.payload,
            job_key_mode = excluded.job_key_mode,
            max_attempts = excluded.max_attempts;
    $body$
  `);
}

export async function capturedJobs(db: TestDb): Promise<readonly CapturedJob[]> {
  const result = await db.execute(sql`
    select task, payload, job_key, job_key_mode, max_attempts
    from graphile_worker.captured_jobs
    order by id
  `);

  const rows = (result as unknown as { readonly rows: readonly CapturedJobRow[] }).rows;

  return rows.map((row) => ({
    task: row.task,
    payload: row.payload,
    jobKey: row.job_key,
    jobKeyMode: row.job_key_mode,
    maxAttempts: row.max_attempts,
  }));
}
