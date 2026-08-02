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
// Interpolation tokens are `{channel}`, `{domain}`, `{page}`, `{count}`,
// `{project}` and `{when}`. THE TOKEN NAMES THEMSELVES ARE AUDITED TEXT:
// `{surface}` would trip the UX vocabulary ban on the word "surface", and any
// `{snake_case}` token would trip the machine-identifier ban. Keep them one
// plain lowercase word.

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

// THERE IS NO PROJECT-NUMBER LABEL HERE, AND ITS ABSENCE IS THE FEATURE.
//
// This step used to open with a field asking for the vendor's own project
// number, which a founder could only answer by leaving the product, finding the
// vendor's settings page and copying a number back. The key alone tells us
// which projects it can read (AD-1), so the number is now something we fetch
// rather than something we ask for. A label for it would be the first thing
// somebody rebuilding the field would reach for; there is nothing to reach for.

export const FIELD_PERSONAL_KEY_LABEL = "Your personal API key";

/**
 * The sentence AD-4's allow-list exists for. Without the vendor's own menu path
 * this step cannot be completed by the person it is written for (P-2).
 */
export const FIELD_PERSONAL_KEY_HELPER =
  "In PostHog: Settings → Personal API keys. Your personal key, not the project key.";

// ---------------------------------------------------------------------------
// What the key buys — the projects it can reach (AD-1, AD-2, AD-3)
// ---------------------------------------------------------------------------
//
// The project number stops being something a founder goes and looks up. The key
// alone tells us which projects they have, so the screen either picks for them
// and says so, or shows the ones it found. Both of those need words, and so
// does the one refusal the shipped table cannot say.

/**
 * More than one project came back, so the founder picks.
 *
 * It opens by confirming the key, because that is the thing they just did and
 * the thing they were least sure about — a bare list leaves them wondering
 * whether the paste worked at all. Then one instruction, naming who reads it,
 * so choosing is a decision about us rather than a form field.
 */
export const PROJECT_PICK_PROMPT =
  "That key works. Choose the project you want Growthmind to read.";

/**
 * Exactly one project came back, so nothing was asked and the connection is
 * already made (AD-3).
 *
 * IT NAMES THE PROJECT, AND THAT IS THE WHOLE POINT. A product that quietly
 * decides for someone and moves on has taken a decision away from them without
 * telling them, and the first they would learn of it is a run against the wrong
 * project. `{project}` is the chosen project's own name, as their account
 * spells it, so it can be checked at a glance.
 *
 * The second sentence is the way back out. Without it this reads as a decision
 * that cannot be undone, which is worse than being asked.
 */
export const PROJECT_AUTO_SELECTED_TEMPLATE =
  "You have one project, {project}, so we connected it for you. Disconnect if that is the wrong one.";

/**
 * The key is real but cannot read the project list.
 *
 * The shipped `invalid_credentials` sentence says "that key did not work", and
 * here that would be false and would send a founder off to make a second key
 * with the same fault. This says which permission is missing and where it is
 * turned on — the vendor's own menu path, which is what AD-4's allow-list
 * exists for.
 *
 * No status number, in any spelling. A three-digit code on this screen is a
 * developer's word that escaped, and it tells the person reading it nothing
 * about what to change.
 */
export const PROJECT_PERMISSION_REFUSAL =
  "That key works, but it is not allowed to read your projects. In PostHog: Settings → Personal API keys → edit the key, give it read access to projects, then try again.";

/**
 * THE EARNED DISCLOSURE, AND IT IS THE ONLY ONE THIS STEP HAS (AD-2).
 *
 * The question this replaced — "Using the EU region, or self-hosting?" — was
 * put to every founder on first render, and it is retired rather than reworded.
 * We now try both hosted regions ourselves before saying anything, so by the
 * time anything about addresses is on screen that question has already been
 * answered; asking it would be telling somebody we had not looked. What is left
 * is the one case the two addresses we ship cannot cover: an account that lives
 * somewhere else.
 *
 * So it appears ONLY after both tries have come back refused, beneath the
 * refusal. A founder on either hosted region never sees an address field at
 * all, and there is no second disclosure left for this one to be rendered
 * beside.
 */
export const FIELD_SELF_HOST_DISCLOSURE = "Running PostHog at an address of your own?";

export const FIELD_REGION_LABEL = "Region address";

/**
 * The shipped default, and it is a PLACEHOLDER now rather than a prefill.
 *
 * As a prefill it made the common case need no typing. There is no common case
 * left: the field is behind an earned disclosure that only a self-hoster ever
 * sees, and a prefilled hosted address there is the one address we have just
 * finished proving does not work for them. Worse, a value sitting in the field
 * would be SENT on the next press, taking the single-request self-host branch
 * and skipping the region walk the founder still needs.
 *
 * As a placeholder it shows the shape an address takes and submits nothing.
 * It is also the correspondence `PROBE_ORIGINS` (packages/adapters) is written
 * against — the same origin family, stated in both places on purpose.
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

/**
 * The one control on the hosted path (AD-6). It replaces eight actions in
 * somebody else's product with one consent screen.
 *
 * The words are the ones Slack itself puts on this button everywhere it is
 * offered, and that familiarity is the reason to keep them rather than write
 * something of our own: a founder who has installed anything into Slack before
 * already knows what pressing this does and where it takes them.
 */
export const ADD_TO_SLACK_LABEL = "Add to Slack";

/**
 * The way through for somebody who cannot use the button above.
 *
 * It only exists on the hosted path, where the button is the obvious thing and
 * this is folded behind a disclosure. On an installation with no Slack app of
 * its own there is no button, the pasted-token form IS the card, and this
 * sentence must not appear at all — a disclosure hiding the only path is the
 * dead end AD-6 exists to avoid.
 *
 * It says what pressing it gives you, because "not using our Slack app?" on its
 * own is a question with no visible answer. And it says "your own" out loud: a
 * bot token comes from an app the founder made, so anybody who has not made one
 * is being pointed at the button instead.
 */
export const SLACK_OWN_APP_DISCLOSURE =
  "Not using our Slack app? Paste your own bot token instead.";

/**
 * After the workspace is attached and before a channel is chosen — the state
 * AD-4 creates by making the two acts separate.
 *
 * The second sentence is the half-connected state said out loud. A workspace
 * with no channel looks connected and delivers nothing, and a founder who walks
 * away here would never learn that from the screen. It is deliberately not the
 * same sentence as `SETUP_NEXT_CHANNEL`, which is the blocker line at the top
 * of the page: that one says where to go, this one says what is at stake once
 * you are here.
 */
export const SLACK_CHANNEL_PICK_PROMPT =
  "Choose the channel we should post in. Nothing arrives anywhere until you pick one.";

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

/**
 * The picker's own label, and it is not the field it replaces.
 *
 * `FIELD_CHANNEL_ID_LABEL` names a value a founder has to go and look up in
 * somebody else's product; this names the thing itself, because on this path
 * the list is the field and no id is ever typed.
 */
export const FIELD_CHANNEL_LABEL = "Channel";

// ---------------------------------------------------------------------------
// What the trip out to Slack and back settled on (AD-5, AD-6, AD-7)
// ---------------------------------------------------------------------------
//
// ###########################################################################
// # SIX SENTENCES, ONE PER OUTCOME, BECAUSE EACH ONE HAS A DIFFERENT NEXT
// # ACTION.
// #
// # `apps/web/lib/first-run/slack-oauth-outcome.ts` settled the VOCABULARY —
// # the set of things that can have happened between pressing the button and
// # landing back here — and deliberately wrote no words, because the words
// # belong here where they are audited. Until they existed, a founder whose
// # consent trip did not work out came back to this screen with a value in the
// # address bar that nothing read: the round trip had an answer and the product
// # had no way to say it.
// #
// # THREE OF THE SIX ARE NOT FAULTS. A workspace attached, a founder who chose
// # not to grant access, and an organization that was already connected. A card
// # that marked all six as something going wrong would be telling somebody off
// # on the two paths where nothing went wrong at all.
// #
// # EACH NAMES WHAT HAPPENED AND THEN WHAT TO DO, IN THAT ORDER. The first half
// # is the part a founder cannot see for themselves; the second is the one
// # action that can change it, and it is never an action they cannot take.
// # `unavailable` is an operator's job, so it points at the pasted token that is
// # already on their screen rather than at the button again — an instruction to
// # retry something that cannot succeed is the one people press until they give
// # up.
// ###########################################################################

/**
 * The workspace is attached, and this is deliberately not "done": there is
 * still nowhere to post.
 *
 * It names the one thing outstanding without repeating the picker's own
 * instruction word for word. `SLACK_CHANNEL_PICK_PROMPT` sits directly beneath
 * this sentence on the same card, and two imperatives in a row read as two
 * separate jobs.
 */
export const SLACK_OAUTH_CONNECTED_NOTICE =
  "Your Slack workspace is connected. The channel below is the last thing we need.";

/**
 * The founder said no on Slack's own consent screen.
 *
 * NOTHING FAILED, SO NOTHING HERE MAY READ AS A FAILURE. They made a choice,
 * and this hands the same choice straight back — including the skip, because
 * somebody who has just declined may well not want to be asked a second time.
 */
export const SLACK_OAUTH_DECLINED_NOTICE =
  "You chose not to give us access in Slack, so nothing here changed. Add us to Slack again whenever you want to, or skip this step for now.";

/**
 * The round trip outlived the signed state. The slow-founder case, and the one
 * that must never be confused with a forgery.
 *
 * Pressing the button again simply works, and this says so with no length of
 * time anywhere in it: how long the state lives is our business, not theirs.
 */
export const SLACK_OAUTH_EXPIRED_NOTICE =
  "The trip out to Slack went stale before you came back, so nothing was connected. Add us to Slack again and it will go through.";

/**
 * This organization already had an active connection.
 *
 * The second sentence is what stops it reading as a failure: there is nothing
 * to undo, nothing to retry, and nothing they got wrong. It says "everyone
 * here" because the connection is shared — a teammate landing on this has not
 * been beaten to a personal setting, they have arrived after their own
 * workspace was already wired up.
 */
export const SLACK_OAUTH_ALREADY_CONNECTED_NOTICE =
  "Slack is already connected for everyone here, so nothing needed to change. There is nothing for you to redo.";

/**
 * This installation has no Slack app of its own (AD-6).
 *
 * An operator's job and not the founder's, so the instruction points at the one
 * path they can finish on their own — and on this branch the pasted-token form
 * is the card in front of them rather than a folded fallback, which is why
 * "below" is true when this renders.
 */
export const SLACK_OAUTH_UNAVAILABLE_NOTICE =
  "This installation has no Slack app of its own, so there was nowhere to send you. Paste your own bot token below instead, or skip this step for now.";

/**
 * Everything else: a state that did not verify, a code Slack refused, a call
 * that did not complete.
 *
 * The honest instruction is to walk the trip again, and the honest second option
 * is the path that does not depend on it working. No code and no identifier:
 * neither would tell the person reading it anything they could act on.
 */
export const SLACK_OAUTH_FAILED_NOTICE =
  "The trip back from Slack did not finish, so nothing was connected. Add us to Slack again, or paste your own bot token instead.";

// ---------------------------------------------------------------------------
// The roadmap line — where the two stubs live now
// ---------------------------------------------------------------------------
//
// THE STUBS LEFT THE NUMBERED SEQUENCE, AND NOTHING ELSE ABOUT THEM CHANGED.
// AD-19's two invariants were "render nothing that could be mistaken for a live
// control" and "not built yet must read as honest rather than abandoned". Both
// are untouched: the `coming-next` arm still carries no property a control
// could be built from, and both sentences below still say what is coming and
// what brings it. What changed is WHERE they sit.
//
// They were the first thing on the screen. A founder opening the product for
// the first time met "Not built yet" before they met anything that worked, and
// the sweep that found it scored the entry state a dead-end for exactly that
// reason. A roadmap belongs under the thing it is a roadmap for.

/**
 * The roadmap's own lead-in. Deliberately not a step, not numbered, and not a
 * heading that competes with the stage's.
 */
export const ROADMAP_LEAD = "Still being built";

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

// ---------------------------------------------------------------------------
// The stage's blocked sentences — what it says BEFORE there is anything to
// watch with (the blocker chain in `./blockers`)
// ---------------------------------------------------------------------------
//
// ###########################################################################
// # THESE FOUR SENTENCES ARE THE DESIGN, NOT DECORATION.
// #
// # The stage sits at the top of this screen from the first paint, before
// # anything is connected. That is only an improvement on burying it at the
// # bottom IF IT ALWAYS NAMES THE ONE THING IT IS WAITING FOR. A panel in the
// # best position on the page saying nothing is the empty step-5 card this
// # rebuild deletes, promoted rather than removed.
// #
// # So each one names EXACTLY ONE next action, in the founder's own words, and
// # points at where on the screen to do it. Not a menu, not a status, not a
// # description of the product. The heading beside them carries the PROGRESS
// # (nothing yet -> we can see your product -> watching) and the sentence
// # carries the PRECISION. That split is why the panel reads as help rather
// # than as noise.
// #
// # THE ARM STEP HAS NO SENTENCE OF ITS OWN HERE, AND THAT IS DELIBERATE.
// # `STAGE_UNARMED_HEADING` and `STAGE_UNARMED_HINT` above already say exactly
// # this, they already ship, and they are already audited. B3: if a shipped
// # string says it, import it — a second spelling of one sentence is the drift
// # the one-home rule exists to stop.
// ###########################################################################

/**
 * The heading once the analytics connection is attached and reading.
 *
 * THE WARMTH BEAT. It is the first moment the product stops asking and starts
 * reporting, and it arrives with the founder's own session counts underneath
 * it — before they have done any work for us. Everything before this is setup;
 * this sentence is the product waking up.
 */
export const SETUP_SEEING_HEADING = "We can see your product.";

/** Nothing attached. The one thing we need, and the fact that it is the only one. */
export const SETUP_NEXT_ANALYTICS =
  "First, connect the analytics you already run. It is the only thing we need to start.";

/** Attached and reading; nowhere to send anything yet. */
export const SETUP_NEXT_DELIVERY = "Next, choose where what we find should arrive.";

/**
 * A workspace is connected but no channel is chosen — the state that only
 * exists because connecting and choosing are two acts now rather than one
 * pasted pair.
 */
export const SETUP_NEXT_CHANNEL = "Almost there — choose the channel it should arrive in.";

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
  personalKeyLabel: FIELD_PERSONAL_KEY_LABEL,
  personalKeyHelper: FIELD_PERSONAL_KEY_HELPER,
  projectPickPrompt: PROJECT_PICK_PROMPT,
  projectAutoSelectedTemplate: PROJECT_AUTO_SELECTED_TEMPLATE,
  projectPermissionRefusal: PROJECT_PERMISSION_REFUSAL,
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
  slackChannelPickPrompt: SLACK_CHANNEL_PICK_PROMPT,
  botTokenLabel: FIELD_BOT_TOKEN_LABEL,
  botTokenPlaceholder: FIELD_BOT_TOKEN_PLACEHOLDER,
  channelIdLabel: FIELD_CHANNEL_ID_LABEL,
  channelIdPlaceholder: FIELD_CHANNEL_ID_PLACEHOLDER,
  channelIdHelper: FIELD_CHANNEL_ID_HELPER,
  channelLabel: FIELD_CHANNEL_LABEL,
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
  FIELD_PERSONAL_KEY_LABEL,
  FIELD_PERSONAL_KEY_HELPER,
  PROJECT_PICK_PROMPT,
  PROJECT_AUTO_SELECTED_TEMPLATE,
  PROJECT_PERMISSION_REFUSAL,
  FIELD_SELF_HOST_DISCLOSURE,
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
  ADD_TO_SLACK_LABEL,
  SLACK_OWN_APP_DISCLOSURE,
  SLACK_CHANNEL_PICK_PROMPT,
  FIELD_BOT_TOKEN_LABEL,
  FIELD_BOT_TOKEN_PLACEHOLDER,
  FIELD_CHANNEL_ID_LABEL,
  FIELD_CHANNEL_ID_PLACEHOLDER,
  FIELD_CHANNEL_ID_HELPER,
  FIELD_CHANNEL_LABEL,
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
