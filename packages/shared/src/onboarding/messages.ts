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

// A new name here is a product decision, and should cost an edit to this list.
export const ONBOARDING_PROPER_NOUNS = [
  "PostHog",
  "Slack",
  "GitHub",
  "GitLab",
  "Claude Code",
  "Cursor",
  "Copilot",
  "Codex",
  "Windsurf",
  "Amplitude",
  "Mixpanel",
] as const;

export const SET_UP_CTA_LABEL = "Set up Growthmind";

export const LANDING_SETTLED_LINE = "You're set up. What we find arrives in your Slack from here.";

// The same moment for a founder who skipped Slack, for whom the line above is false.
export const LANDING_SETTLED_NO_DELIVERY_LINE =
  "You're set up, and what we find has nowhere to arrive: no Slack channel is connected. Connect one to get it where your team already works.";

export const FIRST_RUN_TITLE = "First run";

export const STEP_REPO_TITLE = "Connect your code";

export const STEP_REPO_WHAT_IT_WILL_DO =
  "When this is built, Growthmind will read your code — nothing more — so it can point at the right file when it suggests a fix.";

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

export const LANDING_RUNNING_LINE = "Growthmind is running.";

export const LANDING_DELIVERY_TEMPLATE = "Findings go to #{channel}.";

export const LANDING_NOTHING_TO_CHECK_LINE = "There is nothing here to come back and check.";

// The headlines of the block that REPLACES the running line when something is wrong. The
// detail sentences are the existing liveness lines, so a fault is described once.
export const ATTENTION_SOURCE_FAILING_HEADLINE = "Growthmind is not reading your analytics.";

export const ATTENTION_SOURCE_STOPPED_HEADLINE = "Growthmind has nothing to read.";

export const ATTENTION_NO_DELIVERY_HEADLINE = "What we find has nowhere to arrive.";

export const ATTENTION_NO_DELIVERY_DETAIL =
  "No Slack channel is connected. We are still watching, and nothing we find reaches your team until one is.";

// A named next action per fault: the button below the block is labelled with a destination.
export const ATTENTION_SOURCE_ACTION = "Reconnect it to start reading again:";

export const ATTENTION_NO_DELIVERY_ACTION = "Connect a channel to start receiving findings:";

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
  "The bot has not been invited to any channel in your workspace yet.";

// Slack shows a bot only the private channels it has been invited to, and no scope
// changes that — so the picker's own absence is the thing that needs explaining.
export const SLACK_PRIVATE_CHANNEL_HINT =
  "This list only shows channels the bot has been invited to. To use a private channel, paste this into it in Slack, then refresh the list.";

export const SLACK_INVITE_COMMAND = "/invite @Growthmind";

// The copy control's accessible name. "Copy" alone tells a screen reader which
// button it is and never which of them it is.
export const SLACK_COPY_INVITE_LABEL = "Copy the invite command";

export const REFRESH_CHANNELS_LABEL = "Refresh channels";

export const COPY_LABEL = "Copy";

export const COPIED_LABEL = "Copied";

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

// The one door off the landing page, and the heading of what is behind it. Both halves
// are this string: a link whose label differs from its destination's heading reads as a
// different place, and this page is the only place setup's seven decisions can be changed.
export const SETTINGS_TITLE = "What Growthmind is connected to";

// "goes to", not "is posted to": a failed last post does not unstamp the address.
export const SETTINGS_POSTING_TEMPLATE = "What we find goes to #{channel}.";

// The success moment, which is otherwise a confirmation with no next action.
export const SETTINGS_SETTLED_LINE =
  "That is everything we need. What we find arrives there from now on.";

export const SETTINGS_NO_DELIVERY_LINE =
  "No Slack channel is connected, so what we find has nowhere to arrive. Connect one below and it goes where your team already works.";

// The three things setup configured, in the order they matter: nothing to read makes
// everything downstream moot, and who is excluded only means something once both exist.
export const SETTINGS_SOURCE_GROUP_TITLE = "What it reads";

export const SETTINGS_DELIVERY_GROUP_TITLE = "Where findings go";

export const SETTINGS_EXCLUDED_GROUP_TITLE = "Who is not counted";

// The group still renders with nothing attached: an absent section reads as a thing that
// went missing, and this says what will fill it without claiming it already has.
export const SETTINGS_EXCLUDED_PENDING_LINE =
  "Once analytics is connected we work out which sign-ins are yours, and leave them out of every count.";

export const SETTINGS_SOURCE_CONNECTED_TEMPLATE = "Reading {host}, project {project}.";

export const SETTINGS_SOURCE_NONE_LINE =
  "No analytics account is attached, so there are no sessions to find anything in. Connect one below.";

export const SETTINGS_CHANNEL_CHANGE_LABEL = "Change channel";

export const SETTINGS_CHANNEL_CHANGE_CANCEL = "Keep this channel";

// Replaces the line that declared the channel frozen. The freeze was the D12 answer;
// the cutover is a better one, and this is the consequence it trades for.
export const SETTINGS_CHANNEL_CHANGE_CONSEQUENCE =
  "Anything we found before the change stays with the old channel — we will not send it again. Everything we find from then on goes to the new one.";

export const SETTINGS_CHANNEL_MOVED_TEMPLATE =
  "Findings now go to #{channel}. Nothing already sent was moved or sent a second time.";

export const SETTINGS_CHANNEL_UNCHANGED_LINE =
  "That is already where findings go. Nothing changed.";

export const SETTINGS_CHANNEL_MOVE_REFUSED =
  "That channel could not be set. Findings still go where they went before.";

export const SETTINGS_BACK_LABEL = "Back to your workspace";

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

export const STEP_AGENT_TITLE = "Connect your coding assistant";

// Every vendor literal — the paths, the key names, the command — lives in the
// config templates in `agent-blocks.ts`, never in a sentence here, so the two
// cannot drift (UX §8.3). Where a sentence would name Claude Code mid-clause it
// says "your assistant" instead: the panel already names the one it is showing.
export const STEP_AGENT_HELPER =
  "Whoever writes the code here gives their coding assistant a key. After that it can ask Growthmind what is open and pull a fix to work on, without anyone opening this screen again.";

export const AGENT_PICK_PROMPT = "Which assistant writes your code?";

export const AGENT_PRE_MINT_LINE =
  "The key goes in one config file on your machine. Nothing is installed, and nothing here changes your code.";

export const AGENT_PASTE_INTO_TEMPLATE = "Paste this into {path}";

export const AGENT_RUN_ANYWHERE_LINE = "Run this once, anywhere on your machine.";

export const AGENT_MINT_TEMPLATE = "Create a key for {assistant}";

export const AGENT_MINT_PENDING = "Creating a key…";

export const AGENT_MINT_AGAIN_LABEL = "Create another key";

export const AGENT_MINT_FAILED_LINE =
  "That did not go through, and nothing was created. Try that again.";

export const AGENT_KEY_ONCE_NOTICE =
  "This is the only time this key is shown. Copy it now — it is not stored anywhere you can read it back from.";

export const AGENT_KEY_LABEL = "Your key";

export const AGENT_COPY_KEY_LABEL = "Copy your key";

export const AGENT_COPY_BLOCK_TEMPLATE = "Copy the whole block for {assistant}";

export const AGENT_KEY_GONE_NOTICE =
  "The key was shown once and this screen cannot show it again. If you no longer have it, create another one.";

export const AGENT_KEY_HOLE_NOTICE =
  "The block below has a space where the key goes. Put yours in when you paste it.";

export const AGENT_WAITING_LINE =
  "A key exists for this workspace, and nothing has called us with it yet.";

export const AGENT_WAITING_NEXT =
  "Ask your assistant what is open. This step ticks itself the moment a call arrives — there is nothing here to press.";

export const AGENT_CONNECTED_LINE = "Connected. Your coding assistant has called us with this key.";

export const AGENT_CONNECTED_ORG_LINE =
  "The key belongs to this workspace, so it is connected for everyone here. There is nothing for you to set up.";

export const AGENT_EMPTY_IS_FINE_LINE =
  "If your assistant says nothing is open yet, that is the honest answer and not a fault — it tells you the window it looked at.";

export const AGENT_COPILOT_PROMPTED_NOTE =
  "This file gets committed with your code, so the block asks your editor for the key instead of holding it. Copilot asks you for it the first time, and remembers it after that.";

export const AGENT_COPILOT_USER_SCOPE_TEMPLATE =
  "To use it in every project rather than this one, run {command} from your editor's command palette and paste it there instead.";

export const AGENT_CODEX_ENV_VAR_NOTE =
  "Codex reads the key from an environment variable rather than from the file. Set the variable named in the block to the key above, wherever your shell sets variables, then paste this in.";

export const AGENT_CLAUDE_FILE_DISCLOSURE = "Prefer a file you can commit?";

export const AGENT_CLAUDE_ENV_VAR_NOTE =
  "This file gets committed with your code, so the block reads the key from an environment variable instead of holding it. Set the variable named in the block to the key above, wherever your shell sets variables, before you start your assistant.";

export const AGENT_CLAUDE_TYPE_TRAP =
  "The type line is not optional. Without it, your assistant reads the entry as a local command to launch, so it skips the server and never calls us.";

export const AGENT_CLAUDE_APPROVAL_NOTE =
  "A server declared in a project file needs approving once, the first time your assistant starts in that project.";

export const AGENT_REVOKE_LABEL = "Revoke this key";

export const AGENT_REVOKE_CONSEQUENCE =
  "Revoking turns off every key this workspace has, not just this one. Anything else set up with a key from here — another machine, a build that runs on its own — stops calling us too. This step goes back to needing a key, and you can create a new one straight away.";

export const AGENT_REVOKE_CONFIRM_LABEL = "Yes, revoke it";

export const AGENT_REVOKE_CANCEL_LABEL = "Keep it";

export const AGENT_REVOKED_LINE =
  "That key is revoked and nothing can call us with it. Create another whenever you want to connect again.";

export const AGENT_REVOKE_FAILED_LINE =
  "That key could not be revoked, and it is still working. Try that again.";

export const AGENT_MINTED_ANNOUNCEMENT = "A key was created. It is shown once, on the screen now.";

export const AGENT_KEY_COPIED_ANNOUNCEMENT = "Your key is on the clipboard.";

export const AGENT_BLOCK_COPIED_ANNOUNCEMENT = "The whole block is on the clipboard.";

export const PROVIDER_SOON_BADGE = "Coming soon";

export const INTEREST_PING_LABEL = "Ping me when it's ready";

export const INTEREST_PENDING_LABEL = "Noting…";

export const INTEREST_NOTED_BADGE = "On the list ✓";

export const INTEREST_NOTED_TEMPLATE =
  "On the list — we'll let this workspace know when {provider} lands.";

export const STEP_MOMENT_TITLE = "Trigger an issue";

export const START_WATCHING_LABEL = "Start watching";

export const WATCH_AGAIN_LABEL = "Watch again";

export const DONE_LABEL = "Done";

// The same press, from a screen that is still waiting: leg 1 never ends on its own,
// so a founder who breaks nothing had no way off it at all.
export const FINISH_SETUP_LABEL = "Finish setup";

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

// Split in two: the heading states the fact, so the screen stops claiming it is
// still reading above a sentence saying there is nothing left to wait for.
export const STAGE_UNREADABLE_HEADING = "We found something and could not show it here.";

export const STAGE_FINDING_UNAVAILABLE =
  "Nothing you did caused this, and there is nothing more to wait for on this screen.";

// The screen could not render it; the channel still received it. Without this the
// state named no next action at all and "Done" claimed a completion nobody saw.
export const STAGE_UNREADABLE_DELIVERED_TEMPLATE = "It went to #{channel} — read it there.";

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
  slackPrivateChannelHint: SLACK_PRIVATE_CHANNEL_HINT,
  slackInviteCommand: SLACK_INVITE_COMMAND,
  slackCopyInviteLabel: SLACK_COPY_INVITE_LABEL,
  refreshChannels: REFRESH_CHANNELS_LABEL,
  copy: COPY_LABEL,
  copied: COPIED_LABEL,
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
  settingsSettled: SETTINGS_SETTLED_LINE,
  settingsNoDelivery: SETTINGS_NO_DELIVERY_LINE,
  settingsBack: SETTINGS_BACK_LABEL,
  settingsSourceGroup: SETTINGS_SOURCE_GROUP_TITLE,
  settingsDeliveryGroup: SETTINGS_DELIVERY_GROUP_TITLE,
  settingsExcludedGroup: SETTINGS_EXCLUDED_GROUP_TITLE,
  settingsExcludedPending: SETTINGS_EXCLUDED_PENDING_LINE,
  settingsSourceConnectedTemplate: SETTINGS_SOURCE_CONNECTED_TEMPLATE,
  settingsSourceNone: SETTINGS_SOURCE_NONE_LINE,
  settingsChannelChange: SETTINGS_CHANNEL_CHANGE_LABEL,
  settingsChannelChangeCancel: SETTINGS_CHANNEL_CHANGE_CANCEL,
  settingsChannelChangeConsequence: SETTINGS_CHANNEL_CHANGE_CONSEQUENCE,
  settingsChannelMovedTemplate: SETTINGS_CHANNEL_MOVED_TEMPLATE,
  settingsChannelUnchanged: SETTINGS_CHANNEL_UNCHANGED_LINE,
  settingsChannelMoveRefused: SETTINGS_CHANNEL_MOVE_REFUSED,

  landingRunning: LANDING_RUNNING_LINE,
  landingDeliveryTemplate: LANDING_DELIVERY_TEMPLATE,
  landingNothingToCheck: LANDING_NOTHING_TO_CHECK_LINE,

  stepAgentTitle: STEP_AGENT_TITLE,
  stepAgentHelper: STEP_AGENT_HELPER,
  agentPickPrompt: AGENT_PICK_PROMPT,
  agentPreMintLine: AGENT_PRE_MINT_LINE,
  agentPasteIntoTemplate: AGENT_PASTE_INTO_TEMPLATE,
  agentRunAnywhereLine: AGENT_RUN_ANYWHERE_LINE,
  agentMintTemplate: AGENT_MINT_TEMPLATE,
  agentMintPending: AGENT_MINT_PENDING,
  agentMintAgainLabel: AGENT_MINT_AGAIN_LABEL,
  agentMintFailedLine: AGENT_MINT_FAILED_LINE,
  agentKeyOnceNotice: AGENT_KEY_ONCE_NOTICE,
  agentKeyLabel: AGENT_KEY_LABEL,
  agentCopyKeyLabel: AGENT_COPY_KEY_LABEL,
  agentCopyBlockTemplate: AGENT_COPY_BLOCK_TEMPLATE,
  agentKeyGoneNotice: AGENT_KEY_GONE_NOTICE,
  agentKeyHoleNotice: AGENT_KEY_HOLE_NOTICE,
  agentWaitingLine: AGENT_WAITING_LINE,
  agentWaitingNext: AGENT_WAITING_NEXT,
  agentConnectedLine: AGENT_CONNECTED_LINE,
  agentConnectedOrgLine: AGENT_CONNECTED_ORG_LINE,
  agentEmptyIsFineLine: AGENT_EMPTY_IS_FINE_LINE,
  agentCopilotPromptedNote: AGENT_COPILOT_PROMPTED_NOTE,
  agentCopilotUserScopeTemplate: AGENT_COPILOT_USER_SCOPE_TEMPLATE,
  agentCodexEnvVarNote: AGENT_CODEX_ENV_VAR_NOTE,
  agentClaudeFileDisclosure: AGENT_CLAUDE_FILE_DISCLOSURE,
  agentClaudeEnvVarNote: AGENT_CLAUDE_ENV_VAR_NOTE,
  agentClaudeTypeTrap: AGENT_CLAUDE_TYPE_TRAP,
  agentClaudeApprovalNote: AGENT_CLAUDE_APPROVAL_NOTE,
  agentRevokeLabel: AGENT_REVOKE_LABEL,
  agentRevokeConsequence: AGENT_REVOKE_CONSEQUENCE,
  agentRevokeConfirmLabel: AGENT_REVOKE_CONFIRM_LABEL,
  agentRevokeCancelLabel: AGENT_REVOKE_CANCEL_LABEL,
  agentRevokedLine: AGENT_REVOKED_LINE,
  agentRevokeFailedLine: AGENT_REVOKE_FAILED_LINE,
  agentMintedAnnouncement: AGENT_MINTED_ANNOUNCEMENT,
  agentKeyCopiedAnnouncement: AGENT_KEY_COPIED_ANNOUNCEMENT,
  agentBlockCopiedAnnouncement: AGENT_BLOCK_COPIED_ANNOUNCEMENT,
  roadmapLead: ROADMAP_LEAD,
  providerSoonBadge: PROVIDER_SOON_BADGE,
  interestPingLabel: INTEREST_PING_LABEL,
  interestPendingLabel: INTEREST_PENDING_LABEL,
  interestNotedBadge: INTEREST_NOTED_BADGE,
  interestNotedTemplate: INTEREST_NOTED_TEMPLATE,

  setupSeeingHeading: SETUP_SEEING_HEADING,
  setupNextAnalytics: SETUP_NEXT_ANALYTICS,
  setupNextDelivery: SETUP_NEXT_DELIVERY,
  setupNextChannel: SETUP_NEXT_CHANNEL,

  stepMomentTitle: STEP_MOMENT_TITLE,
  startWatching: START_WATCHING_LABEL,
  watchAgain: WATCH_AGAIN_LABEL,
  done: DONE_LABEL,
  finishSetup: FINISH_SETUP_LABEL,
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
  LANDING_RUNNING_LINE,
  LANDING_DELIVERY_TEMPLATE,
  LANDING_NOTHING_TO_CHECK_LINE,
  ATTENTION_SOURCE_FAILING_HEADLINE,
  ATTENTION_SOURCE_STOPPED_HEADLINE,
  ATTENTION_NO_DELIVERY_HEADLINE,
  ATTENTION_NO_DELIVERY_DETAIL,
  ATTENTION_SOURCE_ACTION,
  ATTENTION_NO_DELIVERY_ACTION,

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
  SLACK_PRIVATE_CHANNEL_HINT,
  SLACK_INVITE_COMMAND,
  SLACK_COPY_INVITE_LABEL,
  REFRESH_CHANNELS_LABEL,
  COPY_LABEL,
  COPIED_LABEL,
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
  SETTINGS_SETTLED_LINE,
  SETTINGS_NO_DELIVERY_LINE,
  SETTINGS_BACK_LABEL,
  SETTINGS_SOURCE_GROUP_TITLE,
  SETTINGS_DELIVERY_GROUP_TITLE,
  SETTINGS_EXCLUDED_GROUP_TITLE,
  SETTINGS_EXCLUDED_PENDING_LINE,
  SETTINGS_SOURCE_CONNECTED_TEMPLATE,
  SETTINGS_SOURCE_NONE_LINE,
  SETTINGS_CHANNEL_CHANGE_LABEL,
  SETTINGS_CHANNEL_CHANGE_CANCEL,
  SETTINGS_CHANNEL_CHANGE_CONSEQUENCE,
  SETTINGS_CHANNEL_MOVED_TEMPLATE,
  SETTINGS_CHANNEL_UNCHANGED_LINE,
  SETTINGS_CHANNEL_MOVE_REFUSED,

  STEP_AGENT_TITLE,
  STEP_AGENT_HELPER,
  AGENT_PICK_PROMPT,
  AGENT_PRE_MINT_LINE,
  AGENT_PASTE_INTO_TEMPLATE,
  AGENT_RUN_ANYWHERE_LINE,
  AGENT_MINT_TEMPLATE,
  AGENT_MINT_PENDING,
  AGENT_MINT_AGAIN_LABEL,
  AGENT_MINT_FAILED_LINE,
  AGENT_KEY_ONCE_NOTICE,
  AGENT_KEY_LABEL,
  AGENT_COPY_KEY_LABEL,
  AGENT_COPY_BLOCK_TEMPLATE,
  AGENT_KEY_GONE_NOTICE,
  AGENT_KEY_HOLE_NOTICE,
  AGENT_WAITING_LINE,
  AGENT_WAITING_NEXT,
  AGENT_CONNECTED_LINE,
  AGENT_CONNECTED_ORG_LINE,
  AGENT_EMPTY_IS_FINE_LINE,
  AGENT_COPILOT_PROMPTED_NOTE,
  AGENT_COPILOT_USER_SCOPE_TEMPLATE,
  AGENT_CODEX_ENV_VAR_NOTE,
  AGENT_CLAUDE_FILE_DISCLOSURE,
  AGENT_CLAUDE_ENV_VAR_NOTE,
  AGENT_CLAUDE_TYPE_TRAP,
  AGENT_CLAUDE_APPROVAL_NOTE,
  AGENT_REVOKE_LABEL,
  AGENT_REVOKE_CONSEQUENCE,
  AGENT_REVOKE_CONFIRM_LABEL,
  AGENT_REVOKE_CANCEL_LABEL,
  AGENT_REVOKED_LINE,
  AGENT_REVOKE_FAILED_LINE,
  AGENT_MINTED_ANNOUNCEMENT,
  AGENT_KEY_COPIED_ANNOUNCEMENT,
  AGENT_BLOCK_COPIED_ANNOUNCEMENT,
  ROADMAP_LEAD,
  PROVIDER_SOON_BADGE,
  INTEREST_PING_LABEL,
  INTEREST_PENDING_LABEL,
  INTEREST_NOTED_BADGE,
  INTEREST_NOTED_TEMPLATE,

  STEP_MOMENT_TITLE,
  START_WATCHING_LABEL,
  WATCH_AGAIN_LABEL,
  DONE_LABEL,
  FINISH_SETUP_LABEL,
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
  STAGE_UNREADABLE_HEADING,
  STAGE_UNREADABLE_DELIVERED_TEMPLATE,
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
