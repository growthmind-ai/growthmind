// EVERY GENUINELY NEW CUSTOMER-FACING STRING ON THE FIRST-RUN SURFACE LIVES
// HERE (O-008, AD-4, FR-O22). One home means the plain-English audit in
// `packages/shared/__tests__/onboarding/messages.test.ts` is a single-file
// review instead of a repo sweep, and every consumer — a route, a view-model, a
// component — imports these rather than re-authoring them (D11: no wire between
// a producer and a consumer to sever).
//
// ###########################################################################
// # WHY THIS MODULE EXISTS BESIDE `session-source/messages.ts` RATHER THAN
// # INSIDE IT, AND WHAT YOU MUST NOT DO ABOUT IT.
// #
// # That module is audited so the VENDOR'S NAME NEVER APPEARS, and that ban is
// # correct and it stays: the pipeline behind the `SessionSource` port does not
// # learn the vendor's name, so a second source needs no copy rewrite.
// #
// # It is also FATAL for a step whose entire job is "In PostHog: Settings →
// # Personal API keys." "Get a key from your analytics provider" is not an
// # instruction anybody can follow. So the onboarding strings get their own
// # home, with their own audit and a TWO-NAME allow-list.
// #
// # DO NOT add these strings to `ALL_CUSTOMER_FACING_MESSAGES` over there — the
// # `/posthog/i` ban would fail on the first one. DO NOT copy that module's
// # vendor-neutral header comment into this file — an implementer who does
// # ships an uncompletable step. And if that module's audit ever goes red, DO
// # NOT "fix" it by copying this file's exception across: `messages.test.ts`
// # re-runs that module's vendor ban from inside this suite precisely so the
// # exception cannot travel.
// ###########################################################################
//
// ── R-LATENCY BINDS HERE, AND IT IS ABSOLUTE ────────────────────────────────
//
// NO STRING IN THIS FILE COMMITS TO A DURATION. No "5-20 seconds", no "about
// 30 seconds", no "~25-35 s", no "this usually takes…". The internal design
// target of ~25-35 s sizes the build and the acceptance run and appears in NO
// RENDERED STRING, ever. The one time value this surface may carry is ELAPSED,
// counting UP from a persisted origin, and it is a NUMBER on a view model —
// never authored copy. A promise can only hide in a sentence, and this file is
// where the sentences are.
//
// ── B3: THE SHIPPED TABLES ARE IMPORTED, NEVER RE-AUTHORED ──────────────────
//
// Connection states, connect refusals, counter labels, exclusion labels, post
// failures, analysis run statuses, analysis outcomes, summary sources and every
// `FLOOR_*` template already ship with their own completeness audits. Only the
// genuinely new strings live here. If you are about to write a sentence that
// one of those tables already says, import it instead.
//
// ── HOW TO ADD A STRING ─────────────────────────────────────────────────────
//
// Export it as a `const`, then register it in `ALL_ONBOARDING_MESSAGES`. The
// audit derives its expected set from this module's ACTUAL exports, so a
// constant that is exported and not registered fails the completeness row
// rather than escaping every scan below it — silently, and forever.
//
// Interpolation tokens are `{channel}`, `{domain}`, `{page}`, `{count}` and
// `{when}`. THE TOKEN NAMES THEMSELVES ARE AUDITED TEXT: `{surface}` would trip
// the UX vocabulary ban on the word "surface", and any `{snake_case}` token
// would trip the machine-identifier ban. Keep them one plain lowercase word.

/**
 * The ONLY proper nouns this surface may name, and why.
 *
 * A step that must tell a person which account to fetch a key from cannot be
 * vendor-neutral: "get a key from your analytics provider" is not an
 * instruction anybody can follow. The ban this replaces is correct for the
 * port's own copy and is unchanged there — see the pinning test.
 *
 * A third name added here is a product decision about what this surface talks
 * about, and it should cost somebody an edit to a list with a comment on it
 * explaining why the list exists — not a quiet mention inside a sentence. Our
 * own name is deliberately absent: "Growthmind" is the first person on this
 * screen, not a third party.
 */
export const ONBOARDING_PROPER_NOUNS = ["PostHog", "Slack"] as const;

// ---------------------------------------------------------------------------
// The landing page (UX Checklist rows 1 and 26)
// ---------------------------------------------------------------------------

/** The one entrance to the surface. FR-O2 turns a plain sentence into this. */
export const SET_UP_CTA_LABEL = "Set up Growthmind";

/** What `/` says once this user has retired the surface. No link, no CTA. */
export const LANDING_SETTLED_LINE = "You're set up. What we find arrives in your Slack from here.";

/** The surface's own header. It names an event, not a wizard. */
export const FIRST_RUN_TITLE = "First run";

// ---------------------------------------------------------------------------
// Step 1 — the code stub (R3)
// ---------------------------------------------------------------------------

export const STEP_REPO_TITLE = "Connect your code";

export const STEP_REPO_WHAT_IT_WILL_DO =
  "When this is built, Growthmind will read your code — nothing more — so it can point at the right file when it suggests a fix.";

/**
 * "Not built yet" on its own is an absence. "Not built yet, and here is what
 * brings it" is a plan, and it is the difference between a founder reading the
 * row as honest and reading it as abandoned (UX Checklist row 4). Nothing here
 * apologises: a product apologising for itself reads as a warning.
 */
export const STEP_REPO_FILLER = "Not built yet. It arrives with the fix-spec work.";

// ---------------------------------------------------------------------------
// Step 2 — the analytics connection (UX Checklist rows 5, 7, 8)
// ---------------------------------------------------------------------------

export const STEP_ANALYTICS_TITLE = "Connect your analytics.";

export const STEP_ANALYTICS_HELPER =
  "Growthmind reads sessions from the PostHog project you already run. It never writes to it.";

export const FIELD_PROJECT_NUMBER_LABEL = "Project number";

/** A number a founder can check against their own account, so it is not masked. */
export const FIELD_PROJECT_NUMBER_PLACEHOLDER = "12345";

export const FIELD_PERSONAL_KEY_LABEL = "Your personal API key";

/**
 * The sentence AD-4's allow-list exists for. Without the vendor's own menu path
 * this step cannot be completed by the person it is written for (P-2).
 */
export const FIELD_PERSONAL_KEY_HELPER =
  "In PostHog: Settings → Personal API keys. Your personal key, not the project key.";

/** The collapsed disclosure. Folded because it is prefilled and correct for most. */
export const FIELD_REGION_DISCLOSURE = "Using the EU region, or self-hosting?";

export const FIELD_REGION_LABEL = "Region address";

/**
 * The shipped default, PREFILLED, so the common case needs no typing at all. A
 * field the product can fill in for you is a field it should not have asked for.
 */
export const FIELD_REGION_PREFILL = "https://us.i.posthog.com";

export const CONNECT_ACTION_LABEL = "Connect";

/** The single progress locus for this step. A verb, not a spinner. */
export const CONNECT_PENDING_LABEL = "Connecting…";

export const DISCONNECT_ACTION_LABEL = "Disconnect";

/**
 * Org-wide, and it says so (UX Checklist row 28). A teammate pressing this must
 * not discover afterwards that they revoked it for everybody.
 */
export const DISCONNECT_CONFIRMATION =
  "Disconnected for everyone in this workspace. Every session and event we already collected is kept.";

// ---------------------------------------------------------------------------
// The counter's own two statements (UX Checklist row 9)
// ---------------------------------------------------------------------------

/**
 * When the last successful check completed.
 *
 * `{when}` is substituted with a formatted date by the view. WHATEVER FORMAT IS
 * CHOSEN MUST NOT READ AS A DURATION — "5 minutes ago" would put a committed
 * length of time on the screen through the back door, and the counter view's
 * own audit walks every rendered string for exactly that pattern.
 */
export const COUNTER_AS_OF_TEMPLATE = "As of {when}.";

/**
 * `asOf` is null. A FACT, not a formatting of nothing — never blank, and never
 * "now", which would claim a check that has not happened.
 */
export const COUNTER_AS_OF_NEVER = "We have not completed a check yet.";

// ---------------------------------------------------------------------------
// The privacy receipt (AD-2, FR-O8, ruling R2)
// ---------------------------------------------------------------------------
//
// SEVEN LINES, and the eighth string below is NOT one of them. The closing line
// is rendered beneath the block, outside the seven, and it must stay outside:
// `buildPrivacyReceipt` returns exactly seven lines and the receipt's own audit
// forbids any line offering to switch something on — which the closing line, by
// design, says out loud.
//
// Nothing here claims a capability this tree does not have. `packages/sdk-js`
// is a stub and stays one this sprint, so no line may say masking, redaction,
// scrubbing, anonymising, encryption, recording, replay or capture. A receipt
// that overstates is the exact failure R2 exists to remove, restated more
// confidently.

/** R2 row 1 — URL paths are stored normalised and versioned, never raw. */
export const RECEIPT_PATHS_LINE =
  "We keep the address of each page as a tidied-up pattern, never the raw address with your customers' own details in it.";

/**
 * R2 row 2 — internal traffic, and WHERE THE GUESS CAME FROM. `{domain}` is the
 * inferred value. Naming it is what lets a founder spot that we guessed wrong
 * before it quietly sets aside the wrong visits.
 */
export const RECEIPT_INTERNAL_DOMAIN_TEMPLATE =
  "Visits from {domain} are set aside as your own team's, worked out from the email address that created this workspace.";

/**
 * R2 row 2, substituted when nothing was inferred (the F-1/F-2 fail direction).
 * It says so, and it says why, and it never states the absence as an error the
 * founder has to go and fix. Nothing is broken: this is the designed direction.
 */
export const RECEIPT_INTERNAL_DOMAIN_UNKNOWN =
  "We could not work out your domain from the email that created this workspace, so we are setting nothing aside — we would rather miss your own team's visits than hide your real users.";

/** R2 row 3 — bots, headless browsers and coding agents. */
export const RECEIPT_AUTOMATION_LINE =
  "Visits from bots, automated browsers and coding agents are set aside too.";

/**
 * R2 row 4 — THE FAIL DIRECTION, DECLARED. An exclusion rule that fires on a
 * superset of its target erases the evidence behind a finding, so this product
 * fails toward setting nothing aside and says that out loud.
 */
export const RECEIPT_FAIL_DIRECTION_LINE =
  "When we are not sure whose visit is whose, we keep it. Setting aside a real customer would hide the very thing you are here to see.";

/** R2 row 5 — identity is a keyed one-way stand-in, never the raw value. */
export const RECEIPT_IDENTITY_LINE =
  "Who someone is, is stored as a scrambled stand-in that cannot be turned back into a name or an address.";

/** R2 row 6 — no bag of event properties is kept at all. */
export const RECEIPT_PROPERTIES_LINE =
  "We keep no bag of event properties at all — only the few things we need to see a path through your product.";

/** R2 row 7 — every outbound message is checked for leftover personal detail. */
export const RECEIPT_OUTBOUND_LINE =
  "Everything we send to your channel is checked for leftover personal details before it leaves.";

export const RECEIPT_TITLE = "What we do and do not collect";

/**
 * The closing line, BENEATH the seven and never inside them. It is the whole
 * reason this block is a receipt rather than a settings panel.
 */
export const RECEIPT_CLOSING_LINE = "Nothing here is a setting. There is nothing to switch on.";

// ---------------------------------------------------------------------------
// Step 3 — Slack (UX Checklist rows 12-16)
// ---------------------------------------------------------------------------

export const STEP_SLACK_TITLE = "Connect Slack.";

export const STEP_SLACK_HELPER = "This is where what we find arrives once setup is done.";

export const FIELD_BOT_TOKEN_LABEL = "Bot token";

export const FIELD_BOT_TOKEN_PLACEHOLDER = "xoxb-…";

export const FIELD_CHANNEL_ID_LABEL = "Channel ID";

export const FIELD_CHANNEL_ID_PLACEHOLDER = "C01AB2CD3EF";

/** The second sentence AD-4's allow-list exists for. */
export const FIELD_CHANNEL_ID_HELPER =
  "In Slack: right-click the channel → View channel details → the ID is at the very bottom. Invite the bot to that channel first.";

export const SEND_TEST_MESSAGE_LABEL = "Send a test message";

export const SEND_TEST_MESSAGE_PENDING = "Sending a test message…";

/** Always available. A skip a founder cannot find is not a skip (deviation 2). */
export const SKIP_FOR_NOW_LABEL = "Skip for now";

export const TRY_AGAIN_LABEL = "Try again";

/**
 * The success confirmation, and it NAMES THE CHANNEL — "a test message was
 * sent" is not a confirmation, because the founder then has to go and look
 * somewhere and we know where.
 *
 * The second sentence is the answer to OQ-O6: the test message IS the
 * announcement to the rest of the workspace, so a teammate learns from the
 * channel rather than from a notification system this sprint does not build.
 */
export const SLACK_TEST_SUCCESS_TEMPLATE =
  "A test message just landed in #{channel}. It names this workspace and who connected it, so your teammates find out from the channel.";

/**
 * The clause a founder cannot work out on their own. The shipped failure
 * sentence says someone will need to reconnect; this says that pressing the
 * button again is not one of their options. Without it, a primary "Try again"
 * is the obvious thing to build and it can never succeed.
 */
export const SLACK_MUST_RECONNECT = "Someone has to reconnect Slack — trying again will not help.";

/** The same shape for a different job, done by a different person. */
export const SLACK_MUST_PICK_ANOTHER_CHANNEL =
  "Someone has to pick another channel — trying again will not help.";

/**
 * Derived from the persisted ABSENCE of a connection, never from a flag, so it
 * survives a reload by construction (FR-O14). It rides in the step, and then in
 * the strip, for as long as that absence lasts.
 */
export const SLACK_SKIPPED_NOTICE =
  "You can still see the next part on this screen. But nothing will arrive anywhere after that until Slack is connected.";

// ---------------------------------------------------------------------------
// Step 4 — the agent stub (R5)
// ---------------------------------------------------------------------------

export const STEP_AGENT_TITLE = "Install the agent server";

export const STEP_AGENT_WHAT_IT_WILL_DO =
  "When this is built, your coding agent will be able to ask Growthmind what is open and pull a fix to work on.";

export const STEP_AGENT_FILLER = "Not built yet. It arrives with the agent-protocol work.";

// ---------------------------------------------------------------------------
// Step 5 — the stage (UX Checklist rows 17-21)
// ---------------------------------------------------------------------------

export const STEP_MOMENT_TITLE = "Trigger an issue";

/** One press. It folds the sequence away AND starts the clock. */
export const START_WATCHING_LABEL = "Start watching";

export const WATCH_AGAIN_LABEL = "Watch again";

/** The one action that retires the surface. */
export const DONE_LABEL = "Done";

export const STAGE_UNARMED_HEADING = "Nothing is being watched yet.";

export const STAGE_UNARMED_HINT =
  "Start watching, then go and cause something to fail in your own product.";

/**
 * RULING (settled by the copy wave): THE FULL STOP IS IN, on both headings.
 *
 * The UX spec renders them three ways — stopped in the First-Run Checklist,
 * unstopped in the Flow A sketch, the phase-B mock and the states table. The
 * Checklist is the only place the spec marks copy as NORMATIVE, and it is the
 * artefact `integration-tester` replays row-by-row as a PR gate. The sketch,
 * the mock and the table are descriptions of the design, not the copy contract.
 * Both headings are full sentences and every other sentence on this surface is
 * stopped; an unstopped one would be the odd one out, not a style.
 *
 * There is exactly one spelling of each. Two spellings in the copy home is the
 * drift the one-home rule exists to stop.
 */
export const STAGE_WATCHING_HEADING = "Watching for what you just did.";

export const STAGE_READING_HEADING = "Reading what came back.";

/**
 * EC-O5, AND IT IS THE ONLY SENTENCE ON THIS SCREEN THAT ADMITS A FAULT.
 *
 * `findingUnavailable` is true when a finding row EXISTS for this project and
 * could not be read back — a genuinely different fact from "nothing has been
 * found yet", which is where a founder spends steps one to four. Without a
 * sentence for it the screen keeps narrating "Reading what came back", which is
 * true and never ends: the reader waits for something that is not coming, on the
 * one screen this whole product exists for. SILENT DEGRADATION IS THE BUG.
 *
 * THREE THINGS IT HAS TO DO, IN THIS ORDER. Say that something WAS found, so
 * the founder does not read this as a quiet product. Say that showing it here is
 * what failed, so they do not go hunting through their own app for a fault that
 * is ours. And END THE WAIT out loud — a terminal state that does not say it is
 * terminal leaves the reader in exactly the place the missing sentence put them.
 *
 * It is not an error dump: no code, no identifier, no "something went wrong",
 * and nothing for them to do. And no duration, in either direction — "try again
 * shortly" would be a promise about a wait we have just ended.
 */
export const STAGE_FINDING_UNAVAILABLE =
  "We found something and could not show it here. Nothing you did caused this, and there is nothing more to wait for on this screen.";

/** What the founder should go and do. The wait is theirs to end. */
export const STAGE_WATCHING_HINT =
  "Go and cause something to fail in your own product — a save that errors, a button that does nothing. Then come back to this tab. We are watching from here.";

/**
 * Nothing forward-looking, and no promise about the wait: it states a property
 * of the screen, which is true whether the founder stays or leaves.
 */
export const STAGE_READING_HINT =
  "You can leave this tab and come back. This screen rebuilds itself from what already happened.";

export const STAGE_FOUND_HEADING = "Here is what we found.";

export const STAGE_FOUND_HINT =
  "Everything below was measured from what happened in your own product.";

/**
 * The ending's hint. It never reads as a fault: an ending with nothing in it is
 * a real answer about a quiet product, not a setup problem.
 */
export const STAGE_ENDED_HINT =
  "Nothing is set up wrong. Try breaking something a bit more obvious, and watch again.";

// The wait log. EVERY LINE IS PAST TENSE and carries its own stamp, so nothing
// on screen is forward-looking and therefore nothing can be read as a promise.
// FR-O18 stops being a rule somebody must remember and becomes a property of
// the shape.

export const STAGE_LOG_ARMED = "you started watching";

export const STAGE_LOG_RETRIEVED = "your failed request reached us";

export const STAGE_LOG_READING = "we started reading it";

/** The connection to the page dropped. The check did not. */
export const STAGE_OFFLINE_NOTICE =
  "We have lost the connection to this page — the check is still running.";

/**
 * The retire line, rendered beneath the finding. It says where the same thing
 * already is, and that this screen is not somewhere to come back to.
 */
export const STAGE_RETIRE_TEMPLATE =
  "The same thing is now in #{channel}. This screen retires with setup — there is nothing here to come back and check.";

// ---------------------------------------------------------------------------
// The strip (UX Checklist row 17)
// ---------------------------------------------------------------------------

export const STRIP_LEAD = "Watching your product";

export const STRIP_SEEN_TEMPLATE = "{count} seen";

export const STRIP_COUNTED_TEMPLATE = "{count} counted";

export const STRIP_POSTING_TO_TEMPLATE = "posting to #{channel}";

/** The disclosure back to the sequence, read-only. A toggle, not navigation. */
export const STRIP_REOPEN_LABEL = "Setup done — show the five steps";

// ---------------------------------------------------------------------------
// The finding card's two fallbacks (FR-O20)
// ---------------------------------------------------------------------------
//
// NEITHER OF THESE IS A SECOND CLASS TABLE. `FLOOR_OBSERVATION_TEMPLATES` and
// `FLOOR_CONFIDENCE_TEMPLATES` already ship, already carry the proof that
// licensed each sentence, and are already audited — a second table keyed by the
// same names here is the D11 fork AD-4 spends a whole decision avoiding, and the
// two would disagree the first time a threshold moved.
//
// These two sentences exist for the OTHER case: a persisted value that falls
// outside the table it keys (D5 — prod contains every shape ever written). The
// alternative is a raw machine key like "changed_mind" rendered at a founder on
// the one screen this MVP exists for, which is a product-decisions §10 breach.

/**
 * The class is not one the shipped table knows. It states the one thing that is
 * still true — something on that page is worth looking at — and claims nothing
 * about what or why, because no predicate established either.
 */
export const FINDING_CLASS_UNKNOWN_TEMPLATE = "Something on {page} is worth a look.";

/**
 * The confidence basis is not one the shipped table knows. It says the weight
 * is unstated rather than inventing one. NO DIGIT, EVER: there is no numeric
 * confidence anywhere in this product, and a number here would be the reader's
 * most memorable takeaway precisely because it looks exact.
 */
export const FINDING_CONFIDENCE_UNKNOWN =
  "How much weight these numbers carry is not stated for this one.";

// ---------------------------------------------------------------------------
// Shared failure copy
// ---------------------------------------------------------------------------

/** Any submit that never reached us. Values are preserved; credentials are not. */
export const NETWORK_FAILURE_NOTICE =
  "Couldn't reach the server — check your connection and try again.";

// ---------------------------------------------------------------------------
// The ergonomic grouping, and the aggregate the audit walks
// ---------------------------------------------------------------------------

/**
 * Every string above, grouped for a component that wants one import.
 *
 * FLAT BY CONSTRUCTION — string values only, no nested objects. The audit's
 * completeness walk reads one level of an exported object, so a nested group
 * would put its sentences outside every scan below while still reaching a
 * screen. If this ever needs sections, add a second flat object rather than a
 * nested one.
 */
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

  stepMomentTitle: STEP_MOMENT_TITLE,
  startWatching: START_WATCHING_LABEL,
  watchAgain: WATCH_AGAIN_LABEL,
  done: DONE_LABEL,
  stripLead: STRIP_LEAD,
  stripReopen: STRIP_REOPEN_LABEL,
  offlineNotice: STAGE_OFFLINE_NOTICE,

  networkFailure: NETWORK_FAILURE_NOTICE,
} as const;

/**
 * Every fixed customer-facing string this surface produces, in one array, so
 * the plain-English audit is TOTAL rather than best-effort.
 *
 * A constant exported above and missing from this list escapes every scan in
 * `messages.test.ts` — silently, and forever. The completeness row is what
 * makes that a failure instead of a habit.
 */
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

  STEP_MOMENT_TITLE,
  START_WATCHING_LABEL,
  WATCH_AGAIN_LABEL,
  DONE_LABEL,
  STAGE_UNARMED_HEADING,
  STAGE_UNARMED_HINT,
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
