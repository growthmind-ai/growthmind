import type { ReplayLane } from "../replays/filters";
import type { ReplayFailureCode } from "./types";

export const REPLAY_FAILURE_MESSAGES: Record<ReplayFailureCode, string> = {
  invalid_credentials: "That key did not work. Check you copied it correctly, then try again.",
  // No address: the vendor behind this installation's analytics is a setting, and a URL here
  // sends people to a product they may not use.
  missing_read_scope:
    "That key can only record sessions, not read them back. Create a new key with read access in your analytics tool, then try again.",
  recording_not_found:
    "We could not find that replay. It may have been deleted, or the reference we kept for it is out of date.",
  unreachable:
    "We could not reach your replay source. Check the address is correct and reachable from this machine, then try again.",
  rate_limited:
    "Your replay source asked us to slow down, so we stopped this check early. We will pick up where we left off on the next one.",
  misconfigured:
    "This installation cannot read session replays yet. Complete the replay source setup, then try again.",
};

export const REPLAY_PULL_STOP_MESSAGES: Record<"page_cap" | "byte_cap", string> = {
  page_cap:
    "This replay has more activity than we read in one visit, so we stopped part way through. What we did read is here, and the rest is still in your analytics.",
  byte_cap:
    "This replay is larger than we read in one visit, so we stopped part way through to keep things quick. What we did read is here, and the rest is still in your analytics.",
};

// The provenance sentence, assembled from these fragments rather than an inline template, so the
// copy sweep reads the words even though the numbers arrive at runtime. See
// .ai/ux/o-050-replays-filters.md §4.2 for the eight forms these compose into.
export const PROVENANCE_SENTENCE_TEMPLATE =
  "{replays} {replayNoun} from {sessions} {sessionPhrase}.";

export const PROVENANCE_COMPANY_CLAUSE_TEMPLATE = "{company} {phrase}";

export const PROVENANCE_ENTRY_CLAUSE_TEMPLATE = "{phrase} that started at {entry}";

export const REPLAY_NOUN_ONE = "replay";

export const REPLAY_NOUN_MANY = "replays";

// The lane phrase is the descriptor's, never the engine's.
export const REPLAY_LANE_PHRASE_ONE: Record<ReplayLane, string> = {
  real: "session",
  simulated: "simulated session",
  excluded: "session we left out of your findings",
};

export const REPLAY_LANE_PHRASE_MANY: Record<ReplayLane, string> = {
  real: "sessions",
  simulated: "simulated sessions",
  excluded: "sessions we left out of your findings",
};

// The reconciliation between the sentence's denominator and the number of cards below it. A
// different fact from the truncation notice, which may render alongside it.
export const REPLAY_TAIL_NOTE_ONE = "1 matching session wasn't recorded, so it isn't listed above.";

export const REPLAY_TAIL_NOTE_MANY =
  "{count} matching sessions weren't recorded, so they aren't listed above.";

// The second sentence is the load-bearing one: the counts are a floor under a bounded read, and
// FR-18 forbids presenting a floor as a total.
export const REPLAY_COUNTS_ARE_A_FLOOR_NOTICE =
  "These are your most recent sessions — we read one page at a time so this screen stays quick. The counts above are for what we read, so there may be more.";

export const REPLAY_NONE_YET_TITLE = "No replays yet";

export const REPLAY_NONE_YET_BODY =
  "They appear here once people have used your product and their sessions have finished. If you expected some by now, the exclusion rules in Settings are the first place to look.";

export const REPLAY_NONE_YET_ACTION = "Check your exclusion rules";

export const REPLAY_NOT_CONNECTED_TITLE = "Connect your analytics to watch replays";

export const REPLAY_NOT_CONNECTED_BODY =
  "Replays come from the same place your events do, so there is nothing to show until it is connected.";

export const REPLAY_NOT_CONNECTED_ACTION = "Connect your analytics";

export const REPLAY_OVER_FILTERED_TITLE = "No sessions match all your filters";

export const REPLAY_OVER_FILTERED_ENTRY_WITH_COMPANY_BODY =
  "Nobody from {company} started at {entry}.";

export const REPLAY_OVER_FILTERED_ENTRY_ALONE_BODY =
  "Nothing that started at {entry} is in this lane.";

export const REPLAY_OVER_FILTERED_COMPANY_BODY = "{company} has nothing that started at {entry}.";

export const REPLAY_OVER_FILTERED_LANE_BODY =
  "Nothing in this lane matches the rest of what you picked.";

export const REPLAY_OVER_FILTERED_COMBINATION_BODY =
  "No single one of them is the reason on its own — it is the combination.";

export const REPLAY_VALUE_MATCHES_NOTHING_BODY =
  "We have no sessions from {value}. It may have aged out of what we hold, or the address may be out of date.";

export const REPLAY_SIMULATED_ZERO_TITLE = "Simulated sessions aren't recorded";

export const REPLAY_SIMULATED_ZERO_BODY =
  "We ran {sessions} simulated sessions through your product, but nothing rendered a browser, so there is nothing to play. What they found is in your findings.";

export const REPLAY_ZERO_FOR_COMPANY_TITLE = "Nothing to watch from {company} yet";

export const REPLAY_ZERO_FOR_COMPANY_BODY =
  "We have seen {sessions} sessions from {company}, but none of them were recorded.";

export const REPLAY_ZERO_FOR_SELECTION_TITLE = "Nothing to watch here yet";

export const REPLAY_ZERO_FOR_SELECTION_BODY =
  "We have seen {sessions} sessions matching this, but none of them were recorded.";

export const REPLAY_SEARCH_NO_MATCH_BODY = 'Nothing matches "{query}".';

export const REPLAY_NOTHING_LEFT_OUT_TITLE = "Nothing was left out";

// An empty Excluded lane is a good answer and has to read as one — this is the surface where a
// customer checks the promise that we set sessions aside for stated reasons.
export const REPLAY_NOTHING_LEFT_OUT_BODY =
  "Every session we have seen counted as a real person. When we set one aside — your own team, a crawler, a coding agent — it appears here with the reason.";

export const REPLAY_FAILED_TITLE = "We could not load your replays just now";

export const REPLAY_FAILED_BODY = "Nothing is lost — it is still in your analytics.";

export const REPLAY_TRY_AGAIN_ACTION = "Try again";

export const REPLAY_CLEAR_COMPANY_ACTION = "Clear the company filter";

export const REPLAY_CLEAR_ENTRY_ACTION = "Clear the page filter";

export const REPLAY_CLEAR_ALL_ACTION = "Clear all filters";

export const REPLAY_SHOW_REAL_PEOPLE_ACTION = "Show real people";

export const REPLAY_SHOW_REAL_PEOPLE_AGAIN_ACTION = "Show real people again";

export const REPLAY_SHOW_ALL_COMPANIES_ACTION = "Show all companies";

export const REPLAY_CLEAR_SEARCH_ACTION = "Clear the search";

export const REPLAY_COMPANY_REST_LABEL = "All companies";

export const REPLAY_ENTRY_REST_LABEL = "All pages";

export const REPLAY_COMPANY_SEARCH_PLACEHOLDER = "acme.com";

export const REPLAY_ENTRY_SEARCH_PLACEHOLDER = "/pricing";

export const REPLAY_COMPANY_PANEL_FOOT =
  "Personal addresses (gmail, yahoo) aren't companies, so they're not listed.";

export const REPLAY_ENTRY_PANEL_FOOT = "The page someone landed on first, not every page they saw.";

export const REPLAY_PANEL_CLEAR_LABEL = "Clear";

export const REPLAY_OPTION_COUNT_TEMPLATE = "{sessions} · {replays} replays";

export const REPLAY_ROW_MORE_PAGES_TEMPLATE = "+{count} more";

// A row whose recording was never narrated still lists where the person landed, and this says
// which of the two a reader is looking at without spending a badge on it.
export const REPLAY_ROW_UNNARRATED_HINT = "No write-up yet";

// The axis names each descriptor heads its panel and summarises its pill with, and the bar's own
// group label. They live here rather than beside the descriptors so the rename sweep covers them.
export const REPLAY_COMPANY_AXIS = "Company";

export const REPLAY_ENTRY_AXIS = "Entry page";

export const REPLAY_WHO_AXIS = "Who counts";

export const REPLAY_FILTER_BAR_LABEL = "Filter replays";

// The denominator's noun in an option's accessible name, which a screen reader hears whatever
// lane is showing — so it is the plain noun rather than REPLAY_LANE_PHRASE_ONE's lane wording.
export const REPLAY_SESSION_NOUN_ONE = "session";

export const REPLAY_SESSION_NOUN_MANY = "sessions";

export const REPLAY_LANE_TITLES: Record<ReplayLane, string> = {
  real: "Real people",
  simulated: "Simulated",
  excluded: "Excluded",
};

export const REPLAY_LANE_DESCRIPTIONS: Record<ReplayLane, string> = {
  real: "Not your team, not automation",
  simulated: "Audience runs from before launch",
  excluded: "And why each one was",
};

export const REPLAY_SIMULATED_BADGE = "simulated";

// The two below are the single-recording surface's single-sentence forms, composed from the
// terminal-state copy above so the two cannot drift. They retire with their callers.
export const REPLAY_NO_CONNECTION = `${REPLAY_NOT_CONNECTED_TITLE}. ${REPLAY_NOT_CONNECTED_BODY}`;

export const REPLAY_LIST_UNREADABLE = `${REPLAY_FAILED_TITLE}. ${REPLAY_FAILED_BODY}`;

export const REPLAY_EMPTY_RECORDING =
  "This replay arrived empty, so there is nothing to play. That usually means the session ended before anything was captured.";

export const ALL_REPLAY_SOURCE_MESSAGES: readonly string[] = [
  ...Object.values(REPLAY_FAILURE_MESSAGES),
  ...Object.values(REPLAY_PULL_STOP_MESSAGES),
  PROVENANCE_SENTENCE_TEMPLATE,
  PROVENANCE_COMPANY_CLAUSE_TEMPLATE,
  PROVENANCE_ENTRY_CLAUSE_TEMPLATE,
  REPLAY_NOUN_ONE,
  REPLAY_NOUN_MANY,
  ...Object.values(REPLAY_LANE_PHRASE_ONE),
  ...Object.values(REPLAY_LANE_PHRASE_MANY),
  REPLAY_TAIL_NOTE_ONE,
  REPLAY_TAIL_NOTE_MANY,
  REPLAY_COUNTS_ARE_A_FLOOR_NOTICE,
  REPLAY_NONE_YET_TITLE,
  REPLAY_NONE_YET_BODY,
  REPLAY_NONE_YET_ACTION,
  REPLAY_NOT_CONNECTED_TITLE,
  REPLAY_NOT_CONNECTED_BODY,
  REPLAY_NOT_CONNECTED_ACTION,
  REPLAY_OVER_FILTERED_TITLE,
  REPLAY_OVER_FILTERED_ENTRY_WITH_COMPANY_BODY,
  REPLAY_OVER_FILTERED_ENTRY_ALONE_BODY,
  REPLAY_OVER_FILTERED_COMPANY_BODY,
  REPLAY_OVER_FILTERED_LANE_BODY,
  REPLAY_OVER_FILTERED_COMBINATION_BODY,
  REPLAY_VALUE_MATCHES_NOTHING_BODY,
  REPLAY_SIMULATED_ZERO_TITLE,
  REPLAY_SIMULATED_ZERO_BODY,
  REPLAY_ZERO_FOR_COMPANY_TITLE,
  REPLAY_ZERO_FOR_COMPANY_BODY,
  REPLAY_ZERO_FOR_SELECTION_TITLE,
  REPLAY_ZERO_FOR_SELECTION_BODY,
  REPLAY_SEARCH_NO_MATCH_BODY,
  REPLAY_NOTHING_LEFT_OUT_TITLE,
  REPLAY_NOTHING_LEFT_OUT_BODY,
  REPLAY_FAILED_TITLE,
  REPLAY_FAILED_BODY,
  REPLAY_TRY_AGAIN_ACTION,
  REPLAY_CLEAR_COMPANY_ACTION,
  REPLAY_CLEAR_ENTRY_ACTION,
  REPLAY_CLEAR_ALL_ACTION,
  REPLAY_SHOW_REAL_PEOPLE_ACTION,
  REPLAY_SHOW_REAL_PEOPLE_AGAIN_ACTION,
  REPLAY_SHOW_ALL_COMPANIES_ACTION,
  REPLAY_CLEAR_SEARCH_ACTION,
  REPLAY_COMPANY_REST_LABEL,
  REPLAY_ENTRY_REST_LABEL,
  REPLAY_COMPANY_SEARCH_PLACEHOLDER,
  REPLAY_ENTRY_SEARCH_PLACEHOLDER,
  REPLAY_COMPANY_PANEL_FOOT,
  REPLAY_ENTRY_PANEL_FOOT,
  REPLAY_PANEL_CLEAR_LABEL,
  REPLAY_OPTION_COUNT_TEMPLATE,
  REPLAY_ROW_MORE_PAGES_TEMPLATE,
  REPLAY_ROW_UNNARRATED_HINT,
  REPLAY_COMPANY_AXIS,
  REPLAY_ENTRY_AXIS,
  REPLAY_WHO_AXIS,
  REPLAY_FILTER_BAR_LABEL,
  REPLAY_SESSION_NOUN_ONE,
  REPLAY_SESSION_NOUN_MANY,
  ...Object.values(REPLAY_LANE_TITLES),
  ...Object.values(REPLAY_LANE_DESCRIPTIONS),
  REPLAY_SIMULATED_BADGE,
  REPLAY_NO_CONNECTION,
  REPLAY_LIST_UNREADABLE,
  REPLAY_EMPTY_RECORDING,
];
