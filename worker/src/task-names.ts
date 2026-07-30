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
   *
   * SEPARATOR IS A COLON, NOT A DOT, and that is load-bearing. Graphile
   * Worker's crontab parser accepts only a letter or underscore followed by
   * letters, digits, colon, slash, underscore or hyphen — a dot is not in that
   * set, so "session-source" + "." + "poll-schedule" failed to parse and the
   * worker CRASHED ON BOOT with "Invalid command specification in line 2 of
   * crontab". It failed in the container and not in unit tests, because
   * nothing below the crontab string had ever been fed to the real parser.
   */
  SESSION_SOURCE_POLL_SCHEDULE: "session-source:poll-schedule",
} as const;

export type TaskName = (typeof TASK)[keyof typeof TASK];

/**
 * The identifier grammar Graphile Worker's crontab parser accepts
 * (CRONTAB_COMMAND in graphile-worker dist/cronConstants.js). Exported so
 * the registry test can assert every TASK value against it — a name that only
 * fails inside a running container is a name no unit test catches.
 */
export const GRAPHILE_TASK_NAME_PATTERN = /^[_a-zA-Z][_a-zA-Z0-9:/_-]*$/;
