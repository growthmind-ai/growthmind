export const ARMED_POLL_MS = 1_000;

export const PRE_ARM_POLL_MS = 10_000;

export interface PollCadenceInput {
  readonly attached: boolean;
  readonly armed: boolean;
}

export function resolvePollCadenceMs(input: PollCadenceInput): number | null {
  if (input.armed) {
    return ARMED_POLL_MS;
  }

  return input.attached ? PRE_ARM_POLL_MS : null;
}
