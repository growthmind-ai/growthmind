// Every genuinely new customer-facing string on the first-run surface lives here
// (O-008, AD-4, FR-O22), audited by `__tests__/onboarding/messages.test.ts`.
//
// THE VENDOR-NAME EXCEPTION. This module may name PostHog and Slack; its sibling
// `session-source/messages.ts` may not, and that ban stays — but "In PostHog:
// Settings → Personal API keys" cannot be written vendor-neutrally. Do NOT
// register these strings over there, and do NOT copy the exception across if that
// module's audit goes red: `messages.test.ts` re-runs that ban from inside this
// suite precisely so the exception cannot travel.
//
// No string here commits to a DURATION (R-LATENCY); elapsed time is a number on a
// view model, never copy. Export a new one as a `const` AND register it in
// `ALL_ONBOARDING_MESSAGES` — the audit derives its expected set from this
// module's exports, so an exported-but-unregistered constant escapes every scan.
// Tokens (`{channel}`, `{domain}`, `{page}`, `{count}`, `{project}`, `{when}`,
// `{workspace}`) are audited text too: keep them one plain lowercase word.

// A third name here is a product decision, and should cost an edit to this list.
export const ONBOARDING_PROPER_NOUNS = ["PostHog", "Slack"] as const;

export const SET_UP_CTA_LABEL = "Set up Growthmind";

export const LANDING_SETTLED_LINE = "You're set up. What we find arrives in your Slack from here.";

// The same moment for a founder who skipped Slack, for whom the line above is false.
export const LANDING_SETTLED_NO_DELIVERY_LINE =
  "You're set up, and what we find has nowhere to arrive: no Slack channel is connected. Connect one to get it where your team already works.";

export const FIRST_RUN_TITLE = "First run";

export const STEP_REPO_TITLE = "Connect your code";

export const STEP_REPO_WHAT_IT_WILL_DO =
  "When this is built, Growthmind will read your code — nothing more — so it can point at the right file when it suggests a fix.";

export const STEP_REPO_FILLER = "Not built yet. It arrives with the fix-spec work.";

export const STEP_ANALYTICS_TITLE = "Connect your analytics.";

export const STEP_ANALYTICS_HELPER =
  "Growthmind reads sessions from the PostHog project you already run. It never writes to it.";

// No project-number label: the key alone says which projects it reads (AD-1).

export const FIELD_PERSONAL_KEY_LABEL = "Your personal API key";

export const FIELD_PERSONAL_KEY_HELPER =
  "In PostHog: Settings → Personal API keys. Your personal key, not the project key.";

export const FIELD_PERSONAL_KEY_PLACEHOLDER = "phx_…";

export const PROJECT_PICK_PROMPT =
  "That key works. Choose the project you want Growthmind to read.";

// Names the project it picked; the second sentence is the way back out.
export const PROJECT_AUTO_SELECTED_TEMPLATE =
  "You have one project, {project}, so we connected it for you. Disconnect if that is the wrong one.";

// No "the key cannot read your projects" sentence: nothing produces that state
// distinguishably — the spike saw 401 for every auth failure and never 403.

// Earned: shown only after both hosted regions have refused (AD-2).
export const FIELD_SELF_HOST_DISCLOSURE = "Running PostHog at an address of your own?";

export const FIELD_REGION_LABEL = "Region address";

// A PLACEHOLDER, not a prefill — a value sitting in the field would be sent on the
// next press, taking the self-host branch and skipping the region walk.
export const FIELD_REGION_PREFILL = "https://us.i.posthog.com";

export const CONNECT_ACTION_LABEL = "Connect";

export const CONNECT_PENDING_LABEL = "Connecting…";

export const DISCONNECT_ACTION_LABEL = "Disconnect";

export const DISCONNECT_CONFIRMATION =
  "Disconnected for everyone in this workspace. Every session and event we already collected is kept.";

export const COUNTER_AS_OF_TEMPLATE = "As of {when}.";

export const COUNTER_AS_OF_NEVER = "We have not completed a check yet.";

export const SINCE_MOMENTS_AGO = "moments ago";

export const SINCE_UNIT_LABELS = {
  minute: "minute",
  hour: "hour",
  day: "day",
} as const;

export const SINCE_TEMPLATE = "{count} {unit} ago";

export const LANDING_LIVENESS_RECEIVING_TEMPLATE =
  "{kept} of {total} events counted as real people. Last checked {when}.";

export const LANDING_LIVENESS_NOTHING_YET_TEMPLATE =
  "Nothing has come through yet, which is what a quiet product looks like. Last checked {when}.";

export const LANDING_LIVENESS_FIRST_CHECK_PENDING =
  "Attached. We have not fetched anything yet — the first check is on its way.";

export const LANDING_LIVENESS_VALIDATING = "We are checking the key you gave us.";

export const LANDING_LIVENESS_FAILING =
  "We could not reach your analytics account on the last try. Everything we already collected is still here.";

export const LANDING_LIVENESS_DISCONNECTED =
  "This project is no longer attached. Everything we already collected is still here.";

export const LANDING_LIVENESS_NOT_CONNECTED =
  "No analytics account is attached to this project yet.";

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

export const ADD_TO_SLACK_LABEL = "Add to Slack";

// Hosted path only: where there is no Slack app of our own the pasted-token form
// IS the card, and a disclosure hiding the only path is AD-6's dead end.
export const SLACK_OWN_APP_DISCLOSURE =
  "Not using our Slack app? Paste your own bot token instead.";

// The half of "connected" a founder cannot see, and the picker beneath makes it
// expensive to get wrong. ABSENT on the pasted-token path, which has no name.
export const SLACK_WORKSPACE_CONNECTED_TEMPLATE = "Connected to {workspace}.";

// The half-connected state out loud: a workspace with no channel delivers nothing.
export const SLACK_CHANNEL_PICK_PROMPT =
  "Choose the channel we should post in. Nothing arrives anywhere until you pick one.";

// A list that arrived empty is not a list that did not arrive: the next action for
// one is "press again", for this one it is "invite the bot in Slack".
export const SLACK_NO_CHANNELS_VISIBLE =
  "Your Slack workspace has no channels the bot can see yet. Invite the bot to the channel you want us to post in, then try again.";

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

// Deliberately the opposite advice to its neighbour. This once read "pick another
// channel", but `attachChannel` never moves a stamped address. It names the SEND
// button, not "Try again": `retryable` stays false, so no Try again renders.
export const SLACK_MUST_INVITE_THE_BOT =
  "The bot has to be invited to that channel before it can post there. Invite it in Slack, then send the test message again.";

export const SLACK_SKIPPED_NOTICE =
  "You can still see the next part on this screen. But nothing will arrive anywhere after that until Slack is connected.";

// The post-setup home for the delivery connection. Setup retires and takes its
// screen with it (deviation 1), so the sentences that name a missing channel need
// somewhere permanent to point at.
export const SETTINGS_TITLE = "Where what we find arrives";

export const SETTINGS_POSTING_TEMPLATE = "What we find is posted to #{channel}.";

export const SETTINGS_NO_DELIVERY_LINE =
  "No Slack channel is connected, so what we find has nowhere to arrive. Connect one below and it goes where your team already works.";

export const SETTINGS_BACK_LABEL = "Back";

// Not the field it replaces: on this path the list IS the field, no id is typed.
export const FIELD_CHANNEL_LABEL = "Channel";

export const FIELD_CHANNEL_PLACEHOLDER = "Choose a channel";

// Six OAuth outcomes, one sentence each, because each has a different next action
// (AD-5, AD-6, AD-7). Three are not faults — attached, declined, already
// connected — so none of those may read as something going wrong.
export const SLACK_OAUTH_CONNECTED_NOTICE =
  "Your Slack workspace is connected. The channel below is the last thing we need.";

export const SLACK_OAUTH_DECLINED_NOTICE =
  "You chose not to give us access in Slack, so nothing here changed. Add us to Slack again whenever you want to, or skip this step for now.";

export const SLACK_OAUTH_EXPIRED_NOTICE =
  "The trip out to Slack went stale before you came back, so nothing was connected. Add us to Slack again and it will go through.";

export const SLACK_OAUTH_ALREADY_CONNECTED_NOTICE =
  "Slack is already connected for everyone here, so nothing needed to change. There is nothing for you to redo.";

// An operator's job, not the founder's, so it points at the pasted-token form —
// the card in front of them on this branch — rather than at a retry that cannot
// succeed, which is the one people press until they give up.
export const SLACK_OAUTH_UNAVAILABLE_NOTICE =
  "This installation has no Slack app of its own, so there was nowhere to send you. Paste your own bot token below instead, or skip this step for now.";

export const SLACK_OAUTH_FAILED_NOTICE =
  "The trip back from Slack did not finish, so nothing was connected. Add us to Slack again, or paste your own bot token instead.";

// The roadmap lead-in. The stubs left the numbered sequence because a founder met
// "Not built yet" before they met anything that worked — a dead-end entry state.
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

// Its sibling above names a check. Before there is one, this claims only what is true.
export const STAGE_OFFLINE_SETUP_NOTICE =
  "We cannot reach the server from this page. Nothing you have set up is affected, and this page keeps trying on its own.";

export const STAGE_DELIVERED_TEMPLATE = "The same thing is now in #{channel}.";

// The second sentence stops the first reading as a failure: the channel is where it
// lands, and this screen is not. No duration and no countdown, ever (R-LATENCY).
export const STAGE_DELIVERY_PENDING_TEMPLATE =
  "Findings for this project go to #{channel}. This one has not been posted there yet — it arrives in the channel, not on this screen.";

export const STAGE_DELIVERY_FAILED_TEMPLATE = "This one did not reach #{channel}.";

// The terminal state with nowhere to deliver: a bare closure leaves a founder who
// skipped Slack with no idea what they gave up, or how to get it.
export const STAGE_NO_DELIVERY_LINE =
  "No Slack channel is connected, so this screen is the only place this has appeared. Connect one to get what we find where your team already works.";

export const STAGE_RETIRE_CLOSURE =
  "This screen retires with setup — there is nothing here to come back and check.";

export const STRIP_LEAD = "Watching your product";

export const STRIP_SEEN_TEMPLATE = "{count} seen";

export const STRIP_COUNTED_TEMPLATE = "{count} counted";

export const STRIP_POSTING_TO_TEMPLATE = "posting to #{channel}";

export const STRIP_REOPEN_LABEL = "Setup done — show the steps";

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
  personalKeyLabel: FIELD_PERSONAL_KEY_LABEL,
  personalKeyHelper: FIELD_PERSONAL_KEY_HELPER,
  personalKeyPlaceholder: FIELD_PERSONAL_KEY_PLACEHOLDER,
  projectPickPrompt: PROJECT_PICK_PROMPT,
  projectAutoSelectedTemplate: PROJECT_AUTO_SELECTED_TEMPLATE,
  selfHostDisclosure: FIELD_SELF_HOST_DISCLOSURE,
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
  addToSlack: ADD_TO_SLACK_LABEL,
  slackOwnAppDisclosure: SLACK_OWN_APP_DISCLOSURE,
  slackWorkspaceConnectedTemplate: SLACK_WORKSPACE_CONNECTED_TEMPLATE,
  slackChannelPickPrompt: SLACK_CHANNEL_PICK_PROMPT,
  slackNoChannelsVisible: SLACK_NO_CHANNELS_VISIBLE,
  botTokenLabel: FIELD_BOT_TOKEN_LABEL,
  botTokenPlaceholder: FIELD_BOT_TOKEN_PLACEHOLDER,
  channelIdLabel: FIELD_CHANNEL_ID_LABEL,
  channelIdPlaceholder: FIELD_CHANNEL_ID_PLACEHOLDER,
  channelIdHelper: FIELD_CHANNEL_ID_HELPER,
  channelLabel: FIELD_CHANNEL_LABEL,
  channelPlaceholder: FIELD_CHANNEL_PLACEHOLDER,
  slackOAuthConnected: SLACK_OAUTH_CONNECTED_NOTICE,
  slackOAuthDeclined: SLACK_OAUTH_DECLINED_NOTICE,
  slackOAuthExpired: SLACK_OAUTH_EXPIRED_NOTICE,
  slackOAuthAlreadyConnected: SLACK_OAUTH_ALREADY_CONNECTED_NOTICE,
  slackOAuthUnavailable: SLACK_OAUTH_UNAVAILABLE_NOTICE,
  slackOAuthFailed: SLACK_OAUTH_FAILED_NOTICE,
  sendTestMessage: SEND_TEST_MESSAGE_LABEL,
  sendingTestMessage: SEND_TEST_MESSAGE_PENDING,
  skipForNow: SKIP_FOR_NOW_LABEL,
  tryAgain: TRY_AGAIN_LABEL,
  slackSkippedNotice: SLACK_SKIPPED_NOTICE,

  settingsTitle: SETTINGS_TITLE,
  settingsPostingTemplate: SETTINGS_POSTING_TEMPLATE,
  settingsNoDelivery: SETTINGS_NO_DELIVERY_LINE,
  settingsBack: SETTINGS_BACK_LABEL,

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
  offlineSetupNotice: STAGE_OFFLINE_SETUP_NOTICE,

  networkFailure: NETWORK_FAILURE_NOTICE,
} as const;

export const ALL_ONBOARDING_MESSAGES: readonly string[] = [
  SET_UP_CTA_LABEL,
  LANDING_SETTLED_LINE,
  LANDING_SETTLED_NO_DELIVERY_LINE,
  FIRST_RUN_TITLE,

  STEP_REPO_TITLE,
  STEP_REPO_WHAT_IT_WILL_DO,
  STEP_REPO_FILLER,

  STEP_ANALYTICS_TITLE,
  STEP_ANALYTICS_HELPER,
  FIELD_PERSONAL_KEY_LABEL,
  FIELD_PERSONAL_KEY_HELPER,
  FIELD_PERSONAL_KEY_PLACEHOLDER,
  PROJECT_PICK_PROMPT,
  PROJECT_AUTO_SELECTED_TEMPLATE,
  FIELD_SELF_HOST_DISCLOSURE,
  FIELD_REGION_LABEL,
  FIELD_REGION_PREFILL,
  CONNECT_ACTION_LABEL,
  CONNECT_PENDING_LABEL,
  DISCONNECT_ACTION_LABEL,
  DISCONNECT_CONFIRMATION,

  COUNTER_AS_OF_TEMPLATE,
  COUNTER_AS_OF_NEVER,

  SINCE_MOMENTS_AGO,
  SINCE_TEMPLATE,
  ...Object.values(SINCE_UNIT_LABELS),

  LANDING_LIVENESS_RECEIVING_TEMPLATE,
  LANDING_LIVENESS_NOTHING_YET_TEMPLATE,
  LANDING_LIVENESS_FIRST_CHECK_PENDING,
  LANDING_LIVENESS_VALIDATING,
  LANDING_LIVENESS_FAILING,
  LANDING_LIVENESS_DISCONNECTED,
  LANDING_LIVENESS_NOT_CONNECTED,

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
  ADD_TO_SLACK_LABEL,
  SLACK_OWN_APP_DISCLOSURE,
  SLACK_WORKSPACE_CONNECTED_TEMPLATE,
  SLACK_CHANNEL_PICK_PROMPT,
  SLACK_NO_CHANNELS_VISIBLE,
  FIELD_BOT_TOKEN_LABEL,
  FIELD_BOT_TOKEN_PLACEHOLDER,
  FIELD_CHANNEL_ID_LABEL,
  FIELD_CHANNEL_ID_PLACEHOLDER,
  FIELD_CHANNEL_ID_HELPER,
  FIELD_CHANNEL_LABEL,
  FIELD_CHANNEL_PLACEHOLDER,
  SLACK_OAUTH_CONNECTED_NOTICE,
  SLACK_OAUTH_DECLINED_NOTICE,
  SLACK_OAUTH_EXPIRED_NOTICE,
  SLACK_OAUTH_ALREADY_CONNECTED_NOTICE,
  SLACK_OAUTH_UNAVAILABLE_NOTICE,
  SLACK_OAUTH_FAILED_NOTICE,
  SEND_TEST_MESSAGE_LABEL,
  SEND_TEST_MESSAGE_PENDING,
  SKIP_FOR_NOW_LABEL,
  TRY_AGAIN_LABEL,
  SLACK_TEST_SUCCESS_TEMPLATE,
  SLACK_MUST_RECONNECT,
  SLACK_MUST_INVITE_THE_BOT,
  SLACK_SKIPPED_NOTICE,

  SETTINGS_TITLE,
  SETTINGS_POSTING_TEMPLATE,
  SETTINGS_NO_DELIVERY_LINE,
  SETTINGS_BACK_LABEL,

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
  STAGE_OFFLINE_SETUP_NOTICE,
  STAGE_DELIVERED_TEMPLATE,
  STAGE_DELIVERY_PENDING_TEMPLATE,
  STAGE_DELIVERY_FAILED_TEMPLATE,
  STAGE_NO_DELIVERY_LINE,
  STAGE_RETIRE_CLOSURE,

  STRIP_LEAD,
  STRIP_SEEN_TEMPLATE,
  STRIP_COUNTED_TEMPLATE,
  STRIP_POSTING_TO_TEMPLATE,
  STRIP_REOPEN_LABEL,

  FINDING_CLASS_UNKNOWN_TEMPLATE,
  FINDING_CONFIDENCE_UNKNOWN,

  NETWORK_FAILURE_NOTICE,
];
