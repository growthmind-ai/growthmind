/**
 * Task identifiers. Graphile Worker matches jobs to handlers by string name,
 * so a raw string here is a silent no-op waiting to happen: a job queued
 * under an unregistered name sits retrying forever, and a typo'd addJob
 * schedules nothing anyone handles. Always queue and register through these
 * constants — the registry test asserts the two sides stay in step.
 */
export const TASK = {
  HEARTBEAT: "heartbeat",
} as const;

export type TaskName = (typeof TASK)[keyof typeof TASK];
