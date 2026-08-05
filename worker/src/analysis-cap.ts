export const COLDSTART_MODEL_CALL_CAP = 12;

export const MEASURED_P90_PULL_MS = 2_046;

export const TICK_INTERVAL_MS = 600_000;

export const PULL_DUTY_CYCLE = 0.5;

// Set by the 429 throttle point M-0 measured, not by the wall-clock duty cycle.
export const RECORDINGS_NARRATED_PER_LANE = 12;

// The lane list is unbounded, so the per-lane cap bounds a lane and nothing else: half a tick
// interval of pulling, so ticks cannot overlap however many lanes are due.
export const RECORDINGS_PULLED_PER_TICK_CEILING = Math.floor(
  (TICK_INTERVAL_MS * PULL_DUTY_CYCLE) / MEASURED_P90_PULL_MS,
);

export const ORG_MODEL_CALL_CAP = 120;
