import {
  SETUP_NEXT_ANALYTICS,
  SETUP_NEXT_CHANNEL,
  SETUP_NEXT_DELIVERY,
  SETUP_SEEING_HEADING,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
} from "./messages";

export type SetupBlockerId = "analytics" | "delivery" | "channel" | "arm";

export type SetupFacts = {
  readonly analyticsAttached: boolean;

  readonly workspaceAttached: boolean;

  readonly deliveryResolved: boolean;

  readonly armedAt: Date | null;
};

export type SetupBlocker = {
  readonly id: SetupBlockerId;

  readonly heading: string;

  readonly sentence: string;
};

type ChainLink = SetupBlocker & {
  readonly met: (facts: SetupFacts) => boolean;
};

const CHAIN: readonly ChainLink[] = Object.freeze([
  {
    id: "analytics",
    met: (facts) => facts.analyticsAttached,
    heading: STAGE_UNARMED_HEADING,
    sentence: SETUP_NEXT_ANALYTICS,
  },
  {
    id: "delivery",
    met: (facts) => facts.workspaceAttached || facts.deliveryResolved,
    heading: SETUP_SEEING_HEADING,
    sentence: SETUP_NEXT_DELIVERY,
  },
  {
    id: "channel",
    met: (facts) => facts.deliveryResolved,
    heading: SETUP_SEEING_HEADING,
    sentence: SETUP_NEXT_CHANNEL,
  },
  {
    id: "arm",
    met: (facts) => facts.armedAt !== null,

    heading: STAGE_UNARMED_HEADING,
    sentence: STAGE_UNARMED_HINT,
  },
]);

export const SETUP_BLOCKERS: readonly SetupBlocker[] = Object.freeze(
  CHAIN.map(({ id, heading, sentence }) => Object.freeze({ id, heading, sentence })),
);

export function nextBlocker(facts: SetupFacts): SetupBlocker | null {
  const link = CHAIN.find((candidate) => !candidate.met(facts));

  return link === undefined
    ? null
    : { id: link.id, heading: link.heading, sentence: link.sentence };
}

export function canArm(facts: SetupFacts): boolean {
  return facts.analyticsAttached && facts.deliveryResolved;
}
