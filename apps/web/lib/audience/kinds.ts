import type { BindingFactKind, BusinessFactKind } from "@growthmind/shared";

// Total over all twelve kinds, so a kind cannot reach the page without a plain-English
// name — a new kind is a compile error here before it is a slug on screen (FR-13).
export const KIND_LABELS: Record<BusinessFactKind, string> = {
  who_counts: "Who counts",
  regime: "The rules of their world",
  forbidden_move: "What we must never do",
  load_bearing_friction: "Friction that is there for a reason",
  conversion: "What counts as a win",
  conversion_disqualifier: "What does not count as a win",
  invalidating_period: "Times when the numbers lie",
  decision_cadence: "How often they decide",
  stake_and_reversibility: "What a mistake costs them",
  arrives_expecting: "What they arrive expecting",
  catalogue_scale: "How much there is to choose from",
  staleness_tolerance: "How fresh things must be",
};

// Typed over the binding kinds only: a shaping row cannot be handed a Changed line by
// accident, and a new binding kind cannot ship without one (FR-9).
export const CHANGED_LINES: Record<BindingFactKind, string> = {
  who_counts: "Decides which sessions enter every count we report.",
  regime: "Bounds every fix — one that breaks these rules never ships.",
  forbidden_move: "Any fix that makes this move is killed before it ships.",
  load_bearing_friction: "Stops us proposing to remove a step your business depends on.",
  conversion: "Every experiment verdict is scored against this.",
  conversion_disqualifier: "Keeps false wins out of every verdict.",
  invalidating_period: "Measurements in this window are set aside, not counted.",
};

// Rendered only on an assumed belief: what would turn the assumption into evidence.
export const SETTLED_BY_LINES: Record<BindingFactKind, string> = {
  who_counts: "More sessions from the people you name — or your one-tap answer below.",
  regime: "You confirming or correcting it — no crawl can settle this.",
  forbidden_move: "You confirming or correcting it.",
  load_bearing_friction: "You confirming or correcting it.",
  conversion: "You confirming or correcting it.",
  conversion_disqualifier: "You confirming or correcting it.",
  invalidating_period: "You confirming the dates.",
};

// The stated-only binding kinds, in the order the page asks about them: no crawl can fill
// these, so an empty one becomes a doubt row. `staleness_tolerance` is stated-only too but
// shapes rather than gates, so it deliberately never earns one — the list must stay short
// enough to be answered.
export const STATED_ONLY_DOUBT_KINDS = [
  "conversion",
  "conversion_disqualifier",
  "load_bearing_friction",
  "invalidating_period",
] as const satisfies readonly BindingFactKind[];

export type StatedOnlyDoubtKind = (typeof STATED_ONLY_DOUBT_KINDS)[number];

export interface StatedOnlyDoubtCopy {
  readonly doubt: string;

  // The one-tap "no" answer, persisted as a stated fact. Null where only free text can answer.
  readonly oneTap: string | null;

  readonly freeTextPrompt: string;
}

export const STATED_ONLY_DOUBTS: Record<StatedOnlyDoubtKind, StatedOnlyDoubtCopy> = {
  conversion: {
    doubt: "We can't read what counts as a win off your site — and every verdict depends on it.",
    oneTap: null,
    freeTextPrompt: "What counts as a win — a signup, a paid plan, a booked call?",
  },
  conversion_disqualifier: {
    doubt: "Is there a kind of win we should not count?",
    oneTap: "No — count them all",
    freeTextPrompt: "What should never count as a win?",
  },
  load_bearing_friction: {
    doubt: "Is there a step that looks like friction but has to stay?",
    oneTap: "No — nothing like that",
    freeTextPrompt: "Which step must stay, and why?",
  },
  invalidating_period: {
    doubt: "Are there times when your numbers lie — a sale, a season, a launch?",
    oneTap: "No — the numbers hold year-round",
    freeTextPrompt: "When do the numbers lie?",
  },
};
