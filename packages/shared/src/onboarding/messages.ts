export const ONBOARDING_PROPER_NOUNS = ["PostHog", "Slack"] as const;

export const SET_UP_CTA_LABEL = "Set up Growthmind";

export const LANDING_SETTLED_LINE = "You're set up. What we find arrives in your Slack from here.";

export const FIRST_RUN_TITLE = "First run";

export const STEP_REPO_TITLE = "Connect your code";

export const STEP_REPO_WHAT_IT_WILL_DO =
  "When this is built, Growthmind will read your code — nothing more — so it can point at the right file when it suggests a fix.";

export const STEP_REPO_FILLER = "Not built yet. It arrives with the fix-spec work.";

export const STEP_ANALYTICS_TITLE = "Connect your analytics.";

export const STEP_ANALYTICS_HELPER =
  "Growthmind reads sessions from the PostHog project you already run. It never writes to it.";

export const FIELD_PROJECT_NUMBER_LABEL = "Project number";

export const FIELD_PROJECT_NUMBER_PLACEHOLDER = "12345";

export const FIELD_PERSONAL_KEY_LABEL = "Your personal API key";

export const FIELD_PERSONAL_KEY_HELPER =
  "In PostHog: Settings → Personal API keys. Your personal key, not the project key.";

export const FIELD_REGION_DISCLOSURE = "Using the EU region, or self-hosting?";

export const FIELD_REGION_LABEL = "Region address";

export const FIELD_REGION_PREFILL = "https://us.i.posthog.com";

export const CONNECT_ACTION_LABEL = "Connect";

export const CONNECT_PENDING_LABEL = "Connecting…";

export const DISCONNECT_ACTION_LABEL = "Disconnect";

export const DISCONNECT_CONFIRMATION =
  "Disconnected for everyone in this workspace. Every session and event we already collected is kept.";

export const COUNTER_AS_OF_TEMPLATE = "As of {when}.";

export const COUNTER_AS_OF_NEVER = "We have not completed a check yet.";

export const RECEIPT_PATHS_LINE =
  "We keep the address of each page as a tidied-up pattern, never the raw address with your customers' own details in it.";

export const RECEIPT_INTERNAL_DOMAIN_TEMPLATE =
  "Visits from {domain} are set aside as your own team's, worked out from the email address that created this workspace.";

export const RECEIPT_INTERNAL_DOMAIN_UNKNOWN =
  "We could not work out your domain from the email that created this workspace, so we are setting nothing aside — we would rather miss your own team's visits than hide your real users.";

export const RECEIPT_AUTOMATION_LINE =
  "Visits from bots, automated browsers and coding agents are set aside too.";

export const RECEIPT_FAIL_DIRECTION_LINE =
  "When we are not sure whose visit is whose, we keep it. Setting aside a real customer would hide the very thing you are here to see.";

export const RECEIPT_IDENTITY_LINE =
  "Who someone is, is stored as a scrambled stand-in that cannot be turned back into a name or an address.";

export const RECEIPT_PROPERTIES_LINE =
  "We keep no bag of event properties at all — only the few things we need to see a path through your product.";

export const RECEIPT_OUTBOUND_LINE =
  "Everything we send to your channel is checked for leftover personal details before it leaves.";

export const RECEIPT_TITLE = "What we do and do not collect";

export const RECEIPT_CLOSING_LINE = "Nothing here is a setting. There is nothing to switch on.";

export const STEP_SLACK_TITLE = "Connect Slack.";

export const STEP_SLACK_HELPER = "This is where what we find arrives once setup is done.";

export const FIELD_BOT_TOKEN_LABEL = "Bot token";

export const FIELD_BOT_TOKEN_PLACEHOLDER = "xoxb-…";

export const FIELD_CHANNEL_ID_LABEL = "Channel ID";

export const FIELD_CHANNEL_ID_PLACEHOLDER = "C01AB2CD3EF";

export const FIELD_CHANNEL_ID_HELPER =
  "In Slack: right-click the channel → View channel details → the ID is at the very bottom. Invite the bot to that channel first.";

export const SEND_TEST_MESSAGE_LABEL = "Send a test message";

export const SEND_TEST_MESSAGE_PENDING = "Sending a test message…";

export const SKIP_FOR_NOW_LABEL = "Skip for now";

export const TRY_AGAIN_LABEL = "Try again";

export const SLACK_TEST_SUCCESS_TEMPLATE =
  "A test message just landed in #{channel}. It names this workspace and who connected it, so your teammates find out from the channel.";

export const SLACK_MUST_RECONNECT = "Someone has to reconnect Slack — trying again will not help.";

export const SLACK_MUST_PICK_ANOTHER_CHANNEL =
  "Someone has to pick another channel — trying again will not help.";

export const SLACK_SKIPPED_NOTICE =
  "You can still see the next part on this screen. But nothing will arrive anywhere after that until Slack is connected.";

export const ROADMAP_LEAD = "Still being built";

export const STEP_AGENT_TITLE = "Install the agent server";

export const STEP_AGENT_WHAT_IT_WILL_DO =
  "When this is built, your coding agent will be able to ask Growthmind what is open and pull a fix to work on.";

export const STEP_AGENT_FILLER = "Not built yet. It arrives with the agent-protocol work.";

export const STEP_MOMENT_TITLE = "Trigger an issue";

export const START_WATCHING_LABEL = "Start watching";

export const WATCH_AGAIN_LABEL = "Watch again";

export const DONE_LABEL = "Done";

export const STAGE_UNARMED_HEADING = "Nothing is being watched yet.";

export const STAGE_UNARMED_HINT =
  "Start watching, then go and cause something to fail in your own product.";

export const SETUP_SEEING_HEADING = "We can see your product.";

export const SETUP_NEXT_ANALYTICS =
  "First, connect the analytics you already run. It is the only thing we need to start.";

export const SETUP_NEXT_DELIVERY = "Next, choose where what we find should arrive.";

export const SETUP_NEXT_CHANNEL = "Almost there — choose the channel it should arrive in.";

export const STAGE_WATCHING_HEADING = "Watching for what you just did.";

export const STAGE_READING_HEADING = "Reading what came back.";

export const STAGE_FINDING_UNAVAILABLE =
  "We found something and could not show it here. Nothing you did caused this, and there is nothing more to wait for on this screen.";

export const STAGE_WATCHING_HINT =
  "Go and cause something to fail in your own product — a save that errors, a button that does nothing. Then come back to this tab. We are watching from here.";

export const STAGE_READING_HINT =
  "You can leave this tab and come back. This screen rebuilds itself from what already happened.";

export const STAGE_FOUND_HEADING = "Here is what we found.";

export const STAGE_FOUND_HINT =
  "Everything below was measured from what happened in your own product.";

export const STAGE_ENDED_HINT =
  "Nothing is set up wrong. Try breaking something a bit more obvious, and watch again.";

export const STAGE_LOG_ARMED = "you started watching";

export const STAGE_LOG_RETRIEVED = "your failed request reached us";

export const STAGE_LOG_READING = "we started reading it";

export const STAGE_OFFLINE_NOTICE =
  "We have lost the connection to this page — the check is still running.";

export const STAGE_RETIRE_TEMPLATE =
  "The same thing is now in #{channel}. This screen retires with setup — there is nothing here to come back and check.";

export const STRIP_LEAD = "Watching your product";

export const STRIP_SEEN_TEMPLATE = "{count} seen";

export const STRIP_COUNTED_TEMPLATE = "{count} counted";

export const STRIP_POSTING_TO_TEMPLATE = "posting to #{channel}";

export const STRIP_REOPEN_LABEL = "Setup done — show the five steps";

export const FINDING_CLASS_UNKNOWN_TEMPLATE = "Something on {page} is worth a look.";

export const FINDING_CONFIDENCE_UNKNOWN =
  "How much weight these numbers carry is not stated for this one.";

export const NETWORK_FAILURE_NOTICE =
  "Couldn't reach the server — check your connection and try again.";

export const ONBOARDING_MESSAGES = {
  setUpCta: SET_UP_CTA_LABEL,
  landingSettled: LANDING_SETTLED_LINE,
  firstRunTitle: FIRST_RUN_TITLE,

  stepRepoTitle: STEP_REPO_TITLE,
  stepRepoWhatItWillDo: STEP_REPO_WHAT_IT_WILL_DO,
  stepRepoFiller: STEP_REPO_FILLER,

  stepAnalyticsTitle: STEP_ANALYTICS_TITLE,
  stepAnalyticsHelper: STEP_ANALYTICS_HELPER,
  projectNumberLabel: FIELD_PROJECT_NUMBER_LABEL,
  projectNumberPlaceholder: FIELD_PROJECT_NUMBER_PLACEHOLDER,
  personalKeyLabel: FIELD_PERSONAL_KEY_LABEL,
  personalKeyHelper: FIELD_PERSONAL_KEY_HELPER,
  regionDisclosure: FIELD_REGION_DISCLOSURE,
  regionLabel: FIELD_REGION_LABEL,
  regionPrefill: FIELD_REGION_PREFILL,
  connect: CONNECT_ACTION_LABEL,
  connecting: CONNECT_PENDING_LABEL,
  disconnect: DISCONNECT_ACTION_LABEL,
  disconnectConfirmation: DISCONNECT_CONFIRMATION,

  counterAsOfTemplate: COUNTER_AS_OF_TEMPLATE,
  counterAsOfNever: COUNTER_AS_OF_NEVER,

  receiptTitle: RECEIPT_TITLE,
  receiptClosing: RECEIPT_CLOSING_LINE,

  stepSlackTitle: STEP_SLACK_TITLE,
  stepSlackHelper: STEP_SLACK_HELPER,
  botTokenLabel: FIELD_BOT_TOKEN_LABEL,
  botTokenPlaceholder: FIELD_BOT_TOKEN_PLACEHOLDER,
  channelIdLabel: FIELD_CHANNEL_ID_LABEL,
  channelIdPlaceholder: FIELD_CHANNEL_ID_PLACEHOLDER,
  channelIdHelper: FIELD_CHANNEL_ID_HELPER,
  sendTestMessage: SEND_TEST_MESSAGE_LABEL,
  sendingTestMessage: SEND_TEST_MESSAGE_PENDING,
  skipForNow: SKIP_FOR_NOW_LABEL,
  tryAgain: TRY_AGAIN_LABEL,
  slackSkippedNotice: SLACK_SKIPPED_NOTICE,

  stepAgentTitle: STEP_AGENT_TITLE,
  stepAgentWhatItWillDo: STEP_AGENT_WHAT_IT_WILL_DO,
  stepAgentFiller: STEP_AGENT_FILLER,
  roadmapLead: ROADMAP_LEAD,

  setupSeeingHeading: SETUP_SEEING_HEADING,
  setupNextAnalytics: SETUP_NEXT_ANALYTICS,
  setupNextDelivery: SETUP_NEXT_DELIVERY,
  setupNextChannel: SETUP_NEXT_CHANNEL,

  stepMomentTitle: STEP_MOMENT_TITLE,
  startWatching: START_WATCHING_LABEL,
  watchAgain: WATCH_AGAIN_LABEL,
  done: DONE_LABEL,
  stripLead: STRIP_LEAD,
  stripReopen: STRIP_REOPEN_LABEL,
  offlineNotice: STAGE_OFFLINE_NOTICE,

  networkFailure: NETWORK_FAILURE_NOTICE,
} as const;

export const ALL_ONBOARDING_MESSAGES: readonly string[] = [
  SET_UP_CTA_LABEL,
  LANDING_SETTLED_LINE,
  FIRST_RUN_TITLE,

  STEP_REPO_TITLE,
  STEP_REPO_WHAT_IT_WILL_DO,
  STEP_REPO_FILLER,

  STEP_ANALYTICS_TITLE,
  STEP_ANALYTICS_HELPER,
  FIELD_PROJECT_NUMBER_LABEL,
  FIELD_PROJECT_NUMBER_PLACEHOLDER,
  FIELD_PERSONAL_KEY_LABEL,
  FIELD_PERSONAL_KEY_HELPER,
  FIELD_REGION_DISCLOSURE,
  FIELD_REGION_LABEL,
  FIELD_REGION_PREFILL,
  CONNECT_ACTION_LABEL,
  CONNECT_PENDING_LABEL,
  DISCONNECT_ACTION_LABEL,
  DISCONNECT_CONFIRMATION,

  COUNTER_AS_OF_TEMPLATE,
  COUNTER_AS_OF_NEVER,

  RECEIPT_PATHS_LINE,
  RECEIPT_INTERNAL_DOMAIN_TEMPLATE,
  RECEIPT_INTERNAL_DOMAIN_UNKNOWN,
  RECEIPT_AUTOMATION_LINE,
  RECEIPT_FAIL_DIRECTION_LINE,
  RECEIPT_IDENTITY_LINE,
  RECEIPT_PROPERTIES_LINE,
  RECEIPT_OUTBOUND_LINE,
  RECEIPT_TITLE,
  RECEIPT_CLOSING_LINE,

  STEP_SLACK_TITLE,
  STEP_SLACK_HELPER,
  FIELD_BOT_TOKEN_LABEL,
  FIELD_BOT_TOKEN_PLACEHOLDER,
  FIELD_CHANNEL_ID_LABEL,
  FIELD_CHANNEL_ID_PLACEHOLDER,
  FIELD_CHANNEL_ID_HELPER,
  SEND_TEST_MESSAGE_LABEL,
  SEND_TEST_MESSAGE_PENDING,
  SKIP_FOR_NOW_LABEL,
  TRY_AGAIN_LABEL,
  SLACK_TEST_SUCCESS_TEMPLATE,
  SLACK_MUST_RECONNECT,
  SLACK_MUST_PICK_ANOTHER_CHANNEL,
  SLACK_SKIPPED_NOTICE,

  STEP_AGENT_TITLE,
  STEP_AGENT_WHAT_IT_WILL_DO,
  STEP_AGENT_FILLER,
  ROADMAP_LEAD,

  STEP_MOMENT_TITLE,
  START_WATCHING_LABEL,
  WATCH_AGAIN_LABEL,
  DONE_LABEL,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
  SETUP_SEEING_HEADING,
  SETUP_NEXT_ANALYTICS,
  SETUP_NEXT_DELIVERY,
  SETUP_NEXT_CHANNEL,
  STAGE_WATCHING_HEADING,
  STAGE_READING_HEADING,
  STAGE_WATCHING_HINT,
  STAGE_READING_HINT,
  STAGE_FOUND_HEADING,
  STAGE_FOUND_HINT,
  STAGE_ENDED_HINT,
  STAGE_FINDING_UNAVAILABLE,
  STAGE_LOG_ARMED,
  STAGE_LOG_RETRIEVED,
  STAGE_LOG_READING,
  STAGE_OFFLINE_NOTICE,
  STAGE_RETIRE_TEMPLATE,

  STRIP_LEAD,
  STRIP_SEEN_TEMPLATE,
  STRIP_COUNTED_TEMPLATE,
  STRIP_POSTING_TO_TEMPLATE,
  STRIP_REOPEN_LABEL,

  FINDING_CLASS_UNKNOWN_TEMPLATE,
  FINDING_CONFIDENCE_UNKNOWN,

  NETWORK_FAILURE_NOTICE,
];
