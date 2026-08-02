export const MAX_CONNECTIONS_PER_RUN = 10;

export const MAX_RUN_DURATION_MS = 55_000;

export const ONBOARDING_WINDOW_MINUTES = 15;

export const ONBOARDING_POLL_INTERVAL_SECONDS = 15;

export const MAX_ONBOARDING_PASSES = 4;

export interface PollPlan {
   
  readonly passes: number;
   
  readonly sleepMsBetween: number;
}

export function resolvePollPlan(input: {
  connectedAt: Date;
  now: Date;
  pollIntervalSeconds: number;
}): PollPlan {
  const elapsedMs = input.now.getTime() - input.connectedAt.getTime();

  if (elapsedMs < ONBOARDING_WINDOW_MINUTES * 60_000) {
    return {
      passes: MAX_ONBOARDING_PASSES,
      sleepMsBetween: ONBOARDING_POLL_INTERVAL_SECONDS * 1000,
    };
  }

  return { passes: 1, sleepMsBetween: 0 };
}

export function isOnboardingPlan(plan: PollPlan): boolean {
  return plan.passes === MAX_ONBOARDING_PASSES;
}
