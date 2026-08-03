export const MAX_CONNECTIONS_PER_RUN = 10;

export const MAX_RUN_DURATION_MS = 55_000;

export const ONBOARDING_WINDOW_MINUTES = 15;

export const ONBOARDING_POLL_INTERVAL_SECONDS = 15;

export const MAX_ONBOARDING_PASSES = 4;

export interface PollPlan {
   
  readonly passes: number;
   
  readonly sleepMsBetween: number;
}

export function isInsideOnboardingWindow(from: Date | null, now: Date): boolean {
  if (from === null) return false;

  return now.getTime() - from.getTime() < ONBOARDING_WINDOW_MINUTES * 60_000;
}

export function resolvePollPlan(input: {
  connectedAt: Date;
  armedAt: Date | null;
  now: Date;
  pollIntervalSeconds: number;
}): PollPlan {
  const insideEitherClock =
    isInsideOnboardingWindow(input.connectedAt, input.now) ||
    isInsideOnboardingWindow(input.armedAt, input.now);

  if (insideEitherClock) {
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
