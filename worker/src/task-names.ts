export const TASK = {
  HEARTBEAT: "heartbeat",

  SESSION_SOURCE_POLL_SCHEDULE: "session-source:poll-schedule",

  DELIVERY_TICK: "delivery:tick",

  ANALYSIS_TICK: "analysis:tick",

  ANALYSIS_ONBOARDING: "analysis:onboarding",

  PROVIDER_INTEREST_TICK: "provider-interest:tick",

  GROWTH_CONTEXT_TICK: "growth-context:tick",
} as const;

export type TaskName = (typeof TASK)[keyof typeof TASK];

export const GRAPHILE_TASK_NAME_PATTERN = /^[_a-zA-Z][_a-zA-Z0-9:/_-]*$/;
