import type { IcpBeliefKind } from "./icp";
import type { SurfaceRole } from "./types";

// One sentence per role, written to be read by a founder and parsed by an agent — §10's
// one-output-two-audiences rule, so there is no second agent-facing wording to drift.
export const SURFACE_ROLE_NOTES: Record<SurfaceRole, string> = {
  makes_money: "This is where people pay.",
  first_value: "This is where someone new first gets something out of this product.",
  leads_to_money: "This is on the way to paying.",
  keeps_people: "This is what brings people back.",
  unknown: "Nothing has been said about what this page is for.",
};

export const NOTHING_KNOWN_YET_NOTE =
  "Nothing has been recorded about this product's pages yet, so treat none of this as a steer.";

export const PAGES_SECTION_TITLE = "What your pages are for";

export const PAGES_SECTION_LEAD =
  "We worked these out from what people actually do on them. Change anything that is wrong and we will stop guessing at it.";

export const PAGES_NONE_YET =
  "We have not worked out what any of your pages are for yet. This fills in on its own once enough people have used your product for the answer to mean anything.";

// The same empty table means something different with nothing attached: it will never fill,
// and the sentence above would be waiting for a day that cannot come.
export const PAGES_NONE_YET_NO_SOURCE =
  "This fills in from what people do in your product, so there is nothing here until your analytics is connected. That is the first thing on this page.";

export const PAGES_CONFIRMED_BY_A_PERSON = "You said so";

export const PAGES_OUR_GUESS = "Our guess";

export const PAGES_ROLE_CHOICES: readonly {
  readonly value: SurfaceRole;
  readonly label: string;
}[] = [
  { value: "makes_money", label: "People pay here" },
  { value: "first_value", label: "People first get something out of it here" },
  { value: "leads_to_money", label: "It is on the way to paying" },
  { value: "keeps_people", label: "It brings people back" },
  { value: "unknown", label: "None of these" },
];

export const PAGES_OFF_LIMITS_NOTE =
  "We will not put a coding agent on this page. Tick this only if changing it is genuinely yours to do.";

export const PAGES_CHANGEABLE_LABEL = "We may change this page";

export const PAGES_SAVED = "Saved.";

export const PAGES_SAVE_FAILED = "That did not save. Try again.";

export const SITE_SECTION_TITLE = "Who your product is for";

export const SITE_SECTION_LEAD =
  "Tell us your website and we will read it to work out who you are building for. You can correct anything we get wrong.";

export const SITE_DOMAIN_LABEL = "Your website";

export const SITE_DOMAIN_PLACEHOLDER = "growthmind.ai";

export const SITE_READ_ACTION = "Read my site";

export const SITE_READ_AGAIN_ACTION = "Read it again";

export const SITE_RUNNING =
  "Reading your site now. This takes about a minute — you can leave this page.";

export const SITE_NEVER_RUN = "Nothing read yet.";

export const SITE_NOTHING_FOUND =
  "We read your site and could not tell who it is for from what is on it. Saying so here is more use than guessing.";

export const SITE_READ_FROM = "Read from";

export const SITE_TOLD_TO_US = "You told us";

export const ICP_BELIEF_HEADINGS: Record<IcpBeliefKind, string> = {
  who_it_is_for: "Who it is for",
  what_they_believe: "What they believe",
  what_they_are_trying_to_do: "What they are trying to do",
};

export const ALL_GROWTH_MESSAGES: readonly string[] = [
  ...Object.values(SURFACE_ROLE_NOTES),
  NOTHING_KNOWN_YET_NOTE,
  PAGES_SECTION_TITLE,
  PAGES_SECTION_LEAD,
  PAGES_NONE_YET,
  PAGES_NONE_YET_NO_SOURCE,
  PAGES_CONFIRMED_BY_A_PERSON,
  PAGES_OUR_GUESS,
  PAGES_OFF_LIMITS_NOTE,
  PAGES_CHANGEABLE_LABEL,
  PAGES_SAVED,
  PAGES_SAVE_FAILED,
  ...PAGES_ROLE_CHOICES.map((choice) => choice.label),
  SITE_SECTION_TITLE,
  SITE_SECTION_LEAD,
  SITE_DOMAIN_LABEL,
  SITE_READ_ACTION,
  SITE_READ_AGAIN_ACTION,
  SITE_RUNNING,
  SITE_NEVER_RUN,
  SITE_NOTHING_FOUND,
  SITE_READ_FROM,
  SITE_TOLD_TO_US,
  ...Object.values(ICP_BELIEF_HEADINGS),
];
