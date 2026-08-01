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
  /**
   * The delivery lane's tick (O-007). CHANNEL-AGNOSTIC for the same reason the
   * poll above is source-agnostic: Slack is today's only delivery channel, but
   * a task named "slack:post" would have to be renamed the day a second channel
   * lands, and a task rename strands every job queued under the old name.
   *
   * Colon separator, never a dot — see the note above; a dot crashes the worker
   * on boot inside `crontab`, and only inside a running container.
   */
  DELIVERY_TICK: "delivery:tick",
  /**
   * The analysis lane's tick (O-011). MODEL-AGNOSTIC, for exactly the reason
   * the poll above is source-agnostic and the delivery tick is channel-agnostic:
   * Anthropic is today's only model vendor, but a task named "anthropic:analyse"
   * would have to be renamed the day a second provider lands, and a task rename
   * strands every job queued under the old name. The handler is the composition
   * root and the only place that learns which vendor — if any — it is talking
   * to; the lane itself cannot name one.
   *
   * Colon separator, never a dot — see the note above; a dot crashes the worker
   * on boot inside `crontab`, and only inside a running container.
   */
  ANALYSIS_TICK: "analysis:tick",
  /**
   * The onboarding fast path (O-008 AD-11). The SAME lane the hourly tick runs,
   * asked for ONE project, seconds after a founder's own broken request reached
   * us — rather than up to an hour later.
   *
   * MODEL-AGNOSTIC and SURFACE-AGNOSTIC for the reason every name above is
   * vendor-agnostic. Colon separator, never a dot — a dot crashes the worker on
   * boot inside `crontab`, and only inside a running container.
   *
   * THIS TASK IS QUEUED, NEVER CRONNED, and it is queued with a `jobKey` of
   * `${TASK.ANALYSIS_ONBOARDING}:${projectId}` under `jobKeyMode:
   * "preserve_run_at"` so N pending triggers for one project collapse into one
   * job that still fires when the FIRST trigger asked. The queueing itself lives
   * in ../index.ts, the only queue-aware file.
   */
  ANALYSIS_ONBOARDING: "analysis:onboarding",
} as const;

export type TaskName = (typeof TASK)[keyof typeof TASK];

/**
 * The identifier grammar Graphile Worker's crontab parser accepts
 * (CRONTAB_COMMAND in graphile-worker dist/cronConstants.js). Exported so
 * the registry test can assert every TASK value against it — a name that only
 * fails inside a running container is a name no unit test catches.
 */
export const GRAPHILE_TASK_NAME_PATTERN = /^[_a-zA-Z][_a-zA-Z0-9:/_-]*$/;
