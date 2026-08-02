// WHAT THE STAGE SAYS BEFORE THERE IS ANYTHING TO WATCH WITH.
//
// ###########################################################################
// # ONE ORDERED CHAIN. THE FIRST UNMET LINK IS WHAT THE SCREEN RENDERS.
// #
// # The stage moved to the TOP of the first-run screen, above the connections
// # rather than below them, because the thing a founder came for should not be
// # the thing they have to scroll past four rows of setup to find. That
// # inversion only pays if the panel in the best position on the page always
// # says something useful — so this module's whole job is to answer, from
// # persisted facts alone, "what is the ONE next thing?".
// #
// # A CHAIN RATHER THAN A SWITCH, AND THE DIFFERENCE MATTERS. A switch over
// # states has to be kept exhaustive by whoever adds a state; an ordered chain
// # of predicates answers a state nobody enumerated by falling through to the
// # next unmet link. Adding a step to setup later — reading your code, the
// # agent server — is ONE ENTRY IN THIS ARRAY. It is not a new screen, a new
// # sentence somewhere else, and a new place for the two to disagree.
// #
// # EVERY `met` IS A PLAIN POSITIVE PREDICATE. No negations, no "unless", no
// # link that is met because a later one is. A reader checks the chain by
// # reading down the `met` column, and the order in the array is the order a
// # founder meets the work.
// ###########################################################################
//
// ── THIS MODULE AUTHORS NO SENTENCE (B3, FR-O22) ────────────────────────────
//
// Every string comes off `./messages`, so the plain-English audit over
// `ALL_ONBOARDING_MESSAGES` sees all of it. The arm link deliberately reuses
// the shipped unarmed pair rather than minting a fifth spelling of "press
// start, then go and break something".
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
//
// It does not describe the wait. Once there is nothing left to block, this
// module returns `null` and `reduceStage` — which already ships, already has
// its branch order settled, and was never the problem — owns every state from
// there. Two modules narrating one panel would be two opinions about it.

import {
  SETUP_NEXT_ANALYTICS,
  SETUP_NEXT_CHANNEL,
  SETUP_NEXT_DELIVERY,
  SETUP_SEEING_HEADING,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
} from "./messages";

/**
 * The four things that can stand between a founder and a watch.
 *
 * Ids are stable and are not display order — the array below is the order.
 * They exist so a test, and a later event, can name a link without depending
 * on its position.
 */
export type SetupBlockerId = "analytics" | "delivery" | "channel" | "arm";

/**
 * The persisted facts the chain reads, and nothing that is itself a blocker.
 *
 * The same discipline `StepSequenceFacts` keeps one file over: these are rows
 * and stamps, so the panel cannot disagree with the state it describes, and a
 * reload cannot resurrect a link nothing recorded. There is no
 * "currentBlocker" column anywhere in this product and there must never be.
 */
export type SetupFacts = {
  /** A connection row exists for this project and is attached. */
  readonly analyticsAttached: boolean;
  /**
   * A workspace is connected — the token is stored — but a channel may not be
   * chosen yet.
   *
   * THIS FACT ONLY EXISTS BECAUSE CONNECTING AND CHOOSING ARE TWO ACTS NOW.
   * On the pasted-token path they land together and this is true exactly when
   * `deliveryResolved` is; on the OAuth path there is a real window between
   * them, and a founder sitting in that window with no sentence to read is the
   * dead-end this whole rebuild is about.
   */
  readonly workspaceAttached: boolean;
  /**
   * Somewhere to deliver, settled: a channel is stored, or the step was
   * deliberately skipped.
   *
   * A SKIP IS A RESOLUTION, NOT A GAP (FR-O14, deviation 2). A founder who
   * chose to walk past Slack must not be blocked by a chain that keeps asking;
   * the honest degraded notice rides in the strip instead.
   */
  readonly deliveryResolved: boolean;
  /** The clock's persisted origin. `null` until somebody starts the watch. */
  readonly armedAt: Date | null;
};

/** One link: what it is, when it stops blocking, and what the stage says while it does. */
export type SetupBlocker = {
  readonly id: SetupBlockerId;
  /** Carries the PROGRESS. Three distinct values across four links, on purpose. */
  readonly heading: string;
  /** Carries the PRECISION — exactly one next action, and where to do it. */
  readonly sentence: string;
};

type ChainLink = SetupBlocker & {
  readonly met: (facts: SetupFacts) => boolean;
};

/**
 * The chain, in the order a founder meets it.
 *
 * READ THE HEADINGS DOWN THE COLUMN: nothing yet, nothing yet, we can see your
 * product, nothing is being watched yet. Three sentences across four links,
 * each warmer than the last, and the one that repeats does so because nothing
 * has changed about what the founder can see yet.
 *
 * `delivery` SITS BEFORE `channel` AND BOTH PREDICATES STAY POSITIVE. Attaching
 * a workspace meets `delivery` and leaves `channel` unmet, which is precisely
 * the mid-OAuth window; skipping the step meets both at once. Neither link
 * needs to know about the other.
 */
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
    // B3: the shipped pair, imported rather than re-authored. See the header.
    heading: STAGE_UNARMED_HEADING,
    sentence: STAGE_UNARMED_HINT,
  },
]);

/** Every link, for a test or a renderer that wants to show the whole chain. */
export const SETUP_BLOCKERS: readonly SetupBlocker[] = Object.freeze(
  CHAIN.map(({ id, heading, sentence }) => Object.freeze({ id, heading, sentence })),
);

/**
 * The one thing standing between this founder and a watch, or `null`.
 *
 * `null` MEANS "HAND OVER TO `reduceStage`", not "nothing to say". The caller
 * renders the shipped stage from there, and that stage owns every state in the
 * wait — this module has no opinion about any of them.
 */
export function nextBlocker(facts: SetupFacts): SetupBlocker | null {
  const link = CHAIN.find((candidate) => !candidate.met(facts));

  return link === undefined
    ? null
    : { id: link.id, heading: link.heading, sentence: link.sentence };
}

/**
 * Whether the founder can start a watch that could ever see anything.
 *
 * THE TRAP THIS CLOSES: the shipped screen rendered "Start watching" at all
 * times, including with nothing connected at all. Pressing it stamped an
 * origin and started a clock over a product we had no way to read — a wait
 * that could not end, offered as the primary action. The button now exists
 * only when the chain has reached its last link, and this predicate is the one
 * place that decides it.
 *
 * DELIVERY IS NOT REQUIRED, AND THAT IS THE SAME DECISION FR-O14 ALREADY MADE.
 * A skipped Slack step still reaches the stage; what is missing is where the
 * result goes afterwards, not the ability to watch.
 */
export function canArm(facts: SetupFacts): boolean {
  return facts.analyticsAttached && facts.deliveryResolved;
}
