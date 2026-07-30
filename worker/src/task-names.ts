/**
 * Task identifiers. Graphile Worker matches jobs to handlers by string name,
 * so a raw string here is a silent no-op waiting to happen: a job queued
 * under an unregistered name sits retrying forever, and a typo'd addJob
 * schedules nothing anyone handles. Always queue and register through these
 * constants — the registry test asserts the two sides stay in step.
 */
export const TASK = {
  HEARTBEAT: "heartbeat",
  /**
   * Deliberately SOURCE-AGNOSTIC. A vendor-named task
   * ("posthog.poll-schedule") would have to be renamed the day a second
   * adapter lands, and a task rename is exactly the stringly-typed hazard the
   * comment above describes: jobs queued under the old name sit retrying
   * forever. The handler is the composition root and the only place that
   * learns which vendor it is talking to.
   */
  SESSION_SOURCE_POLL_SCHEDULE: "session-source.poll-schedule",
} as const;

export type TaskName = (typeof TASK)[keyof typeof TASK];
