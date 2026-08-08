import type { ConnectionStateStatus } from "../session-source/types";
import type { ConnectionTone } from "./types";

export const PRODUCT_CARD_TITLE = "Your product";

export const ANALYTICS_CARD_TITLE = "Where sessions come from";

export const DELIVERY_CARD_TITLE = "Where findings go";

export const PRODUCT_UNKNOWN_HEADLINE = "We do not know your website yet";

export const PRODUCT_UNKNOWN_STATEMENT =
  "Tell us your address and we read it, so what we find is about your product rather than a funnel with no name on it.";

// No duration, promised or hedged (R-LATENCY): the read finishes in a worker whose pace
// nothing here knows, and the page updates itself when it does.
export const PRODUCT_READING_STATEMENT =
  "We are reading your site now. This page updates itself when it finishes.";

export const PRODUCT_FAILED_STATEMENT =
  "We could not read your site on the last try. What we already knew is still here.";

export const PRODUCT_READ_STATEMENT = "This is the product every finding is about.";

export const PRODUCT_NEVER_READ_STATEMENT = "We have your address and have not read the site yet.";

export const NOTHING_ATTACHED_HEADLINE = "Nothing connected";

export const DELIVERY_NO_CHANNEL_STATEMENT =
  "Slack is connected, but no channel is chosen — so nothing can arrive yet. Pick one below.";

export const DELIVERY_LIVE_STATEMENT = "Findings arrive here from now on, in Slack.";

// Every card carries a word for its own state, so the state is readable without
// working it out from the sentence underneath.
export const ANALYTICS_STATUS_LABELS: Record<ConnectionStateStatus, string> = {
  not_connected: "Not connected",
  validating: "Checking",
  connected_never_polled: "First check due",
  connected_no_events_yet: "Nothing yet",
  connected_receiving: "Receiving",
  failing: "Not reachable",
  disconnected: "Detached",
};

export const ANALYTICS_STATUS_TONES: Record<ConnectionStateStatus, ConnectionTone> = {
  not_connected: "off",
  validating: "waiting",
  connected_never_polled: "waiting",
  connected_no_events_yet: "waiting",
  connected_receiving: "live",
  failing: "attention",
  disconnected: "off",
};

export const DELIVERY_STATUS_NONE = "Not connected";
export const DELIVERY_STATUS_NO_CHANNEL = "No channel chosen";
export const DELIVERY_STATUS_LIVE = "Delivering";

export const PRODUCT_STATUS_UNKNOWN = "Not set";
export const PRODUCT_STATUS_READING = "Reading";
export const PRODUCT_STATUS_FAILED = "Could not read";
export const PRODUCT_STATUS_NEVER_READ = "Not read yet";
export const PRODUCT_STATUS_READ = "Read";

export const CONNECTION_FACT_LABELS = {
  website: "Website",
  pagesSeen: "Pages seen",
  project: "Project",
  address: "Address",
  events: "Events",
  newestSession: "Newest session",
  lastCheck: "Last check",
  checkEvery: "We check",
  connectedSince: "Connected",
  problem: "The problem",
  workspace: "Workspace",
  channel: "Channel",
} as const;

// Every count says out of how many, so a number can never be read as a total it is not.
export const EVENTS_FACT_TEMPLATE = "{kept} counted of {total} received";

export const EVENTS_SET_ASIDE_SUFFIX_TEMPLATE = ", {setAside} set aside";

export const EVENTS_NONE_YET = "none received yet";

export const PAGES_SEEN_TEMPLATE = "{count} on your site";

export const PAGES_SEEN_NONE = "none yet";

export const CHECK_EVERY_SECONDS_TEMPLATE = "every {count} seconds";

export const CHECK_EVERY_MINUTES_TEMPLATE = "every {count} minutes";

export const WORKSPACE_UNNAMED = "your workspace";

// The card names the product; the control that changes it lives with the rest of what we
// know about the business, so the card points at it rather than holding a second copy.
// "again" is only true once a read has happened — offering it before the first one
// contradicts the same card's own sentence saying the site has not been read.
export const PRODUCT_SET_ACTION = "Add your website";

export const PRODUCT_READ_ACTION = "Change it, or read the site";

export const PRODUCT_REREAD_ACTION = "Change it, or read the site again";

export const PRODUCT_EDIT_ACTION = "Change your website";

export const ALL_CONNECTION_MESSAGES: readonly string[] = [
  PRODUCT_CARD_TITLE,
  ANALYTICS_CARD_TITLE,
  DELIVERY_CARD_TITLE,
  PRODUCT_UNKNOWN_HEADLINE,
  PRODUCT_UNKNOWN_STATEMENT,
  PRODUCT_READING_STATEMENT,
  PRODUCT_FAILED_STATEMENT,
  PRODUCT_READ_STATEMENT,
  PRODUCT_NEVER_READ_STATEMENT,
  NOTHING_ATTACHED_HEADLINE,
  DELIVERY_NO_CHANNEL_STATEMENT,
  DELIVERY_LIVE_STATEMENT,
  DELIVERY_STATUS_NONE,
  DELIVERY_STATUS_NO_CHANNEL,
  DELIVERY_STATUS_LIVE,
  PRODUCT_STATUS_UNKNOWN,
  PRODUCT_STATUS_READING,
  PRODUCT_STATUS_FAILED,
  PRODUCT_STATUS_NEVER_READ,
  PRODUCT_STATUS_READ,
  EVENTS_FACT_TEMPLATE,
  EVENTS_SET_ASIDE_SUFFIX_TEMPLATE,
  EVENTS_NONE_YET,
  PAGES_SEEN_TEMPLATE,
  PAGES_SEEN_NONE,
  CHECK_EVERY_SECONDS_TEMPLATE,
  CHECK_EVERY_MINUTES_TEMPLATE,
  WORKSPACE_UNNAMED,
  PRODUCT_SET_ACTION,
  PRODUCT_READ_ACTION,
  PRODUCT_REREAD_ACTION,
  PRODUCT_EDIT_ACTION,
  ...Object.values(ANALYTICS_STATUS_LABELS),
  ...Object.values(CONNECTION_FACT_LABELS),
];
