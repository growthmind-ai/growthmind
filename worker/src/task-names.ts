import { BUSINESS_RESEARCH_TASK, BUSINESS_RESEARCH_TASK_BEFORE_RENAME } from "@growthmind/shared";

export const TASK = {
  HEARTBEAT: "heartbeat",

  SESSION_SOURCE_POLL_SCHEDULE: "session-source:poll-schedule",

  DELIVERY_TICK: "delivery:tick",

  ANALYSIS_TICK: "analysis:tick",

  ANALYSIS_ONBOARDING: "analysis:onboarding",

  PROVIDER_INTEREST_TICK: "provider-interest:tick",

  GROWTH_CONTEXT_TICK: "growth-context:tick",

  BUSINESS_RESEARCH: BUSINESS_RESEARCH_TASK,

  // A job queued under the old name before this deploy has to find a handler, or it retries
  // against nothing until it exhausts its attempts (D9). Removable once none are left.
  BUSINESS_RESEARCH_BEFORE_RENAME: BUSINESS_RESEARCH_TASK_BEFORE_RENAME,
} as const;

export type TaskName = (typeof TASK)[keyof typeof TASK];

export const GRAPHILE_TASK_NAME_PATTERN = /^[_a-zA-Z][_a-zA-Z0-9:/_-]*$/;
