import type { BusinessFactKind } from "./business";
import type { FactSeen } from "./provenance";
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

export const BUSINESS_SECTION_TITLE = "Your business";

export const BUSINESS_SECTION_LEAD =
  "This is what a coding agent is told before it touches anything of yours. Two kinds of thing live here: what it must never break, and how your product is actually used. We read what we can off your site — the rest only you can answer.";

export const SITE_DOMAIN_LABEL = "Your website";

export const SITE_DOMAIN_PLACEHOLDER = "growthmind.ai";

export const SITE_READ_ACTION = "Read my site";

export const SITE_READ_AGAIN_ACTION = "Read it again";

export const SITE_RUNNING =
  "Reading your site now. This takes about a minute — you can leave this page.";

export const SITE_NEVER_RUN = "Nothing read yet.";

export const SITE_NOTHING_FOUND =
  "We read your site and it did not tell us much. Everything below is still worth answering yourself — the parts that stop us breaking something are the parts a website never says.";

export const BINDING_SECTION_TITLE = "What we must not break";

export const BINDING_SECTION_LEAD =
  "Any one of these can stop a change shipping, whatever it would do to your numbers. This is the part that keeps a growth tool from doing you harm.";

export const SHAPING_SECTION_TITLE = "How your product gets used";

export const SHAPING_SECTION_LEAD =
  "None of these block anything. They decide how a change gets built once it is worth building.";

export const BUSINESS_FACT_HEADINGS: Record<BusinessFactKind, string> = {
  regime: "What rules bind you",
  forbidden_move: "What we must never do",
  load_bearing_friction: "What we must never take away",
  conversion: "What counts as this working",
  conversion_disqualifier: "What stops it counting",
  invalidating_period: "When a result cannot be trusted",
  who_counts: "Whose visits count",
  decision_cadence: "How often people decide",
  stake_and_reversibility: "What is at stake each time",
  arrives_expecting: "What people turn up expecting",
  catalogue_scale: "How much there is to get through",
  staleness_tolerance: "How fresh things have to be",
};

// One sentence for the person and the agent both — §10's one-output-two-audiences rule.
export const BUSINESS_FACT_NOTES: Record<BusinessFactKind, string> = {
  regime:
    "Rules this product is held to. A change that breaks one of these does not ship, whatever it does to the numbers.",
  forbidden_move: "Never build this, even somewhere it would work.",
  load_bearing_friction:
    "Never take this away to make a number go up. It is in the way on purpose.",
  conversion: "What a change is trying to move. Anything else moving is not the point.",
  conversion_disqualifier: "What takes a win back. Count this before calling anything a win.",
  invalidating_period: "Do not trust a result measured across one of these.",
  who_counts: "Whose sessions a finding should be counted over.",
  decision_cadence:
    "How often the same person comes back to decide, which sets whether speed or care matters more.",
  stake_and_reversibility:
    "What one action costs and whether it can be undone, which sets how much confirming to build.",
  arrives_expecting:
    "What people already expect on arrival, usually from whatever they used before this.",
  catalogue_scale: "How much there is to get through, which decides whether browsing works at all.",
  staleness_tolerance: "How old this product's data may be before showing it is wrong.",
};

export const FACT_CLAIM_LABEL = "You say";

export const FACT_OBSERVED_LABEL = "We see";

export const FACT_EDIT_HINT = "Anything we got wrong, click it and type over it.";

export const FACT_NONE_READ_YET = "Your site has not been read yet.";

export const FACT_NOTHING_ON_YOUR_SITE = "Your site did not say. Add it if it matters.";

// The five nothing crawls. Saying "not read yet" under one would be waiting for a day that
// cannot come — no read will ever fill it.
export const FACT_ONLY_YOU_KNOW = "Only you can answer this one.";

export const FACT_OBSERVED_NONE_YET =
  "Not answered from what people do yet. This fills in on its own, once enough people have used your product for an answer to mean anything.";

// The same empty lane means something different with nothing attached: it will never fill.
export const FACT_OBSERVED_NO_SOURCE =
  "This fills in from what people do in your product, so there is nothing here until your analytics is connected. That is the first thing on this page.";

export const AUDIENCE_PROPOSAL_LEAD = "We can count this as";

export const AUDIENCE_CONFIRM_ACTION = "Use this";

export const AUDIENCE_REJECT_ACTION = "Not right";

// The unconfirmed state has to say what is true right now, not what could be true later. A
// proposal sitting unanswered narrows nothing, and a screen that implies otherwise would
// have someone reading a finding against a denominator they think they set.
export const AUDIENCE_UNCONFIRMED_NOTE =
  "Until you say, findings are counted over everyone who visits.";

export const AUDIENCE_CONFIRMED_NOTE = "Findings are counted over these sessions only.";

export const AUDIENCE_REJECTED_NOTE = "Set aside. Findings are counted over everyone who visits.";

export const FACT_SEEN_TEMPLATE = "Seen in {sessions} of {of} sessions, {from} to {to}";

// Fixed locale: this is rendered on a server and sent as text to both a browser and an
// agent, so anything locale-dependent would differ from what was sent.
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function renderSeenSentence(seen: FactSeen): string {
  return FACT_SEEN_TEMPLATE.replaceAll("{sessions}", String(seen.sessions))
    .replaceAll("{of}", String(seen.of))
    .replaceAll("{from}", DAY_MONTH.format(seen.from))
    .replaceAll("{to}", DAY_MONTH.format(seen.to));
}

export const FACT_ADD_ACTION = "Add";

export const FACT_ADD_LABEL = "What is true here";

export const FACT_SAVE_ACTION = "Save";

export const FACT_CANCEL_ACTION = "Cancel";

export const FACT_CORRECTED_NOTE = "You corrected this";

export const FACT_EDIT_LABEL = "What is true instead";

export const FACT_REMOVE_ACTION = "Remove";

export const FACT_FULL_FOR_KIND = "That is as many as we will hold for this one.";

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
  BUSINESS_SECTION_TITLE,
  BUSINESS_SECTION_LEAD,
  SITE_DOMAIN_LABEL,
  SITE_READ_ACTION,
  SITE_READ_AGAIN_ACTION,
  SITE_RUNNING,
  SITE_NEVER_RUN,
  SITE_NOTHING_FOUND,
  BINDING_SECTION_TITLE,
  BINDING_SECTION_LEAD,
  SHAPING_SECTION_TITLE,
  SHAPING_SECTION_LEAD,
  ...Object.values(BUSINESS_FACT_HEADINGS),
  ...Object.values(BUSINESS_FACT_NOTES),
  FACT_CLAIM_LABEL,
  FACT_OBSERVED_LABEL,
  FACT_EDIT_HINT,
  FACT_NONE_READ_YET,
  FACT_NOTHING_ON_YOUR_SITE,
  FACT_ONLY_YOU_KNOW,
  FACT_OBSERVED_NONE_YET,
  FACT_OBSERVED_NO_SOURCE,
  FACT_ADD_ACTION,
  FACT_ADD_LABEL,
  FACT_SAVE_ACTION,
  FACT_CANCEL_ACTION,
  FACT_CORRECTED_NOTE,
  FACT_EDIT_LABEL,
  FACT_REMOVE_ACTION,
  FACT_FULL_FOR_KIND,
];
