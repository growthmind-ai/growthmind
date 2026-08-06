#!/usr/bin/env bun

// Raw SQL strings rather than drizzle's `sql` tag: `drizzle-orm` and `pg` resolve from
// packages/db/node_modules, not from here, so every dependency this script has reaches it
// through packages/db's own source. Read-only aggregates, no interpolation, no user input.
import { createDb } from "../../packages/db/src/index";

const url = process.env.DATABASE_URL;
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set. Run under `railway run`.");
  process.exit(1);
}

const db = createDb(url);

async function rows(label: string, query: string): Promise<void> {
  try {
    const result = await db.execute(query);
    console.log(`\n## ${label}`);
    console.table(result.rows);
  } catch (error) {
    console.log(`\n## ${label}`);
    console.log(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("M-0 — transcript coverage, read-only. Writes nothing.");
console.log(`Ran at ${new Date().toISOString()}`);

await rows(
  "Sessions by key prefix",
  `select split_part(session_key, ':', 1) as prefix, count(*) as sessions,
          count(distinct project_id) as projects, count(distinct organization_id) as orgs
   from sessions group by 1 order by 2 desc`,
);

await rows(
  "Recording summaries — volume and null started_at (research finding #3)",
  `select count(*) as recording_summaries,
          count(*) filter (where started_at is null) as null_started_at,
          count(distinct project_id) as projects,
          count(distinct recording_id) as distinct_recording_ids
   from recording_summaries`,
);

await rows(
  "THE JOIN HYPOTHESIS — sessions.session_key = 'ph:' || recording_id",
  `select
     (select count(*) from sessions where session_key like 'ph:%') as ph_sessions,
     (select count(*) from recording_summaries) as recordings,
     (select count(*) from recording_summaries r
        join sessions s on s.session_key = 'ph:' || r.recording_id
       and s.project_id = r.project_id) as overlap_same_project,
     (select count(*) from recording_summaries r
        join sessions s on s.session_key = 'ph:' || r.recording_id) as overlap_any_project`,
);

await rows(
  "Transcript size distribution (proxy for bytes — action_count and duration)",
  `select count(*) as n,
          percentile_disc(0.5) within group (order by action_count) as p50_actions,
          percentile_disc(0.9) within group (order by action_count) as p90_actions,
          max(action_count) as max_actions,
          percentile_disc(0.5) within group (order by duration_ms) as p50_duration_ms,
          percentile_disc(0.9) within group (order by duration_ms) as p90_duration_ms,
          percentile_disc(0.9) within group (order by dropped_events) as p90_dropped,
          max(dropped_events) as max_dropped
   from recording_summaries`,
);

await rows(
  "Stored transcript bytes (the rendered text today, per row)",
  `select count(*) as n,
          percentile_disc(0.5) within group (order by octet_length(transcript)) as p50_bytes,
          percentile_disc(0.9) within group (order by octet_length(transcript)) as p90_bytes,
          max(octet_length(transcript)) as max_bytes
   from recording_summaries`,
);

// `is_active`, not `status`: project_connections has no status column
// (packages/db/src/schema/project-connections.ts:69), so the original spelling errored.
await rows(
  "Active project connections (the M-0 denominator for a live pull)",
  `select count(*) as connections, count(*) filter (where is_active) as active
   from project_connections`,
);

await db.$client.end();
