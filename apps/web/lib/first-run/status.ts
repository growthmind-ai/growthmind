// THE ONE PAYLOAD THE WHOLE SURFACE RECONCILES AGAINST (O-008, AD-3, AD-6,
// AD-18).
//
// ###########################################################################
// # NOTHING HERE IS MINTED AND NOTHING IS HAND-PASSED (D11).
// #
// # Every field below is read from a row that already exists, or derived HERE
// # from something this function fetched itself, by the consumer that renders
// # it. There is no producer computing a value and attaching it to a response
// # for a later surface to read — which is the shape whose wire gets severed
// # and whose "when present…" branch then never runs, with producer tests and
// # consumer tests both green.
// #
// #   armedAt / retrievedAt / readingAt / endedAt / runStatus / runOutcome
// #                       -> `createFirstRunStatusService(...).read(projectId)`
// #   counter             -> `createEventsCounterService(...).read(projectId)`
// #   channelId           -> the `slack_connections` row (FR-O13)
// #   slackWorkspaceAttached
// #                       -> THE SAME ROW, existence only: `slack !== null`
// #                          (AD-4 row 4). Never `channelId !== null`.
// #   slackWorkspaceName  -> the same row's `workspace_name`. `null` on the
// #                          pasted-token path, which is never told one.
// #   slackNotice         -> derived from that row being ABSENT **or having no
// #                          channel** (AD-4 row 2). Not a flag anywhere.
// #   slackOAuthAvailable -> `slackOAuthConfigured(parseServerEnv(process.env))`
// #                          — READ HERE, not accepted as an input (AD-6).
// #   slackSkippedAt      -> the `first_run_state` row
// #   finding             -> already mapped AND validated by the status
// #                          service's boundary parse. NOT RE-PARSED HERE.
// #
// # `slackOAuthAvailable` is the one field on this payload whose source is not
// # a row, and it is therefore the one D11 names by construction: a boolean the
// # server computes for a client to branch on. It is read INSIDE this function
// # rather than threaded in through `BuildFirstRunStatusInput`, so all four
// # callers — the poll route, the arm route, the skip route and the server
// # page — carry it without any of them knowing it exists. A thread that no
// # caller has to remember is a thread nobody can forget to attach.
// ###########################################################################
//
// ── AD-3: THE COUNTER'S DURATION FIELD IS NOT IN SCOPE ANYWHERE BELOW ───────
//
// The shipped `EventsSeenCounter` carries a lag estimate. It is a real,
// correct contract with one producer and it is NOT deleted — it is NARROWED
// OUT at this boundary by `toOnboardingCounterView`, whose target type is
// written by explicit field enumeration rather than by omitting one name from
// the wide one. An omission silently re-admits the NEXT duration-bearing field
// somebody adds; the enumeration refuses it by default.
//
// `describeExpectedLag` computes `pollIntervalSeconds + 25` and `+ 220`, so
// with the shipped column default of 60 the wide counter states EIGHTY-FIVE
// AND TWO HUNDRED AND EIGHTY SECONDS. R-LATENCY is absolute: the internal
// design target is never rendered as copy, in any form. Reaching that field
// from this surface is now a compile error rather than a discipline somebody
// has to remember, and the route suite scans this response for its name at any
// depth, including object keys.
//
// ── FR-O14: THE DEGRADED NOTICE IS DERIVED FROM AN ABSENCE, NOT FROM A FLAG ─
//
// Two mechanisms, deliberately. `slackSkippedAt` drives the STEP STATE, so
// `skipped` is distinguishable from `pending` after a reload. THE ABSENCE OF A
// DELIVERABLE ADDRESS drives the NOTICE, which is what makes the notice
// survive a reload AND a later disconnect by construction. A `slackConnected`
// boolean cached onto `first_run_state` would be the hand-passed wire this
// split exists to avoid — written by one path, read by another, and stale the
// moment anybody else disconnects.
//
// AD-4 WIDENED WHAT "ABSENT" MEANS HERE, AND THE WIDENING IS THE WHOLE REASON
// THIS FILE CHANGED. Since `channel_id` became nullable a connection row can
// exist with a real bot token and no channel — a workspace attached, mid-OAuth,
// delivering NOTHING. `slack === null` alone answers `null` for that org, so
// the screen would tell a founder everything is fine while nothing can arrive,
// with no error anywhere and no test failing. The notice is therefore derived
// from `slack === null || slack.channelId === null`, and the two absences get
// DIFFERENT sentences because they have different next actions: connect Slack
// at all, versus pick the channel we should post in.
import type { ScopedDb } from "@growthmind/db";
import {
  createEventsCounterService,
  createFirstRunRepo,
  createFirstRunStatusService,
  createSlackConnectionsRepo,
} from "@growthmind/db";
import type { FirstRunStatus, StagePersistedFacts, TenantContext } from "@growthmind/shared";
import {
  CONNECTION_STATE_MESSAGES,
  SLACK_CHANNEL_PICK_PROMPT,
  SLACK_SKIPPED_NOTICE,
  parseServerEnv,
  toOnboardingCounterView,
} from "@growthmind/shared";

// THE ONE PLACE THAT DECIDES WHETHER THIS INSTALLATION HAS A SLACK APP, and it
// is deliberately not re-derived here. `env.ts` names that module by name: "one
// alone cannot complete the round trip. That check belongs to the composition
// root that reads them together (apps/web/lib/slack/oauth.ts)". A second
// `ID !== undefined && SECRET !== undefined` written inline here would be a
// second home for one decision, and the two would disagree the first time
// either grew a condition.
import { slackOAuthConfigured } from "@/lib/slack/oauth";

/**
 * What the status route answers with.
 *
 * A SUPERSET OF `FirstRunStatus`, and every added field is named here rather
 * than left to a component to derive:
 *
 * - `connectionMessage` is the shipped sentence for the counter's own state,
 *   read from `CONNECTION_STATE_MESSAGES` and never authored at a call site
 *   (B3, one home). The seven states are pairwise distinct and so are their
 *   sentences; a screen can never land in an "I don't know what this is"
 *   branch.
 * - `slackSkippedAt` is the persisted stamp the step state needs.
 * - `slackNotice` is FR-O14's degraded line, derived from the absence above.
 * - `slackWorkspaceAttached` / `slackWorkspaceName` / `slackOAuthAvailable` are
 *   AD-4's and AD-6's three additions, each with a named consumer and each
 *   documented on the field itself.
 * - `findingUnavailable` is the one thing a `finding: null` cannot say — see
 *   the note on it.
 */
export type FirstRunStatusPayload = FirstRunStatus & {
  /**
   * A finding row EXISTS for this project and could not be rendered.
   *
   * `finding: null` collapses two genuinely different facts: "nothing has been
   * found yet", which is where a founder spends steps 1 to 4, and "we found
   * something and could not read our own row", which is a fault they are owed
   * an answer about. SILENT DEGRADATION IS A BUG (EC-O5): a customer told
   * nothing cannot act, and the payoff screen going quiet is the worst place
   * in the product for it to happen.
   *
   * A BOOLEAN RATHER THAN A SENTENCE, deliberately: every customer-facing
   * string on this surface lives in `packages/shared/src/onboarding/messages`
   * (FR-O22), and there is no shipped sentence for this state yet. The UI wave
   * renders it; this wire says only what is true.
   */
  readonly findingUnavailable: boolean;
  /** The shipped sentence for `counter.state.status`. Never authored here. */
  readonly connectionMessage: string;
  /** `null` until somebody deliberately walks past the Slack step. */
  readonly slackSkippedAt: Date | null;
  /**
   * FR-O14, derived from the absence of a DELIVERABLE ADDRESS — no connection
   * at all, or a connection with no channel (AD-4 row 2). Two absences, two
   * sentences; see the header.
   */
  readonly slackNotice: string | null;
  /**
   * AD-4 row 4: THE PRODUCER `SetupFacts.workspaceAttached` HAS BEEN WAITING
   * FOR SINCE THE BLOCKER CHAIN SHIPPED.
   *
   * `slack !== null`, and deliberately NOT `channelId !== null`. Without this
   * the screen cannot tell "no Slack at all" from "Slack is attached, pick a
   * channel", so the chain's `channel` link is unreachable, its sentence has
   * never rendered for anyone, and a founder sitting between the consent screen
   * and the channel picker is re-asked for a token their org has already given
   * us.
   *
   * It is NOT an input to `deliveryResolved` and must never become one — an org
   * with a workspace and no channel has nowhere to deliver, and folding this in
   * there would open the arm gate over a setup that cannot finish (AD-4 row 5).
   */
  readonly slackWorkspaceAttached: boolean;
  /**
   * Slack's own name for the attached workspace, for "Connected to {workspace}."
   *
   * `null` on the pasted-token path, which is handed a token and a channel and
   * is never told a name — the sentence is then simply not rendered rather than
   * rendered around an empty hole. Not a credential: every member of the
   * workspace can already read it.
   */
  readonly slackWorkspaceName: string | null;
  /**
   * AD-6. Whether this INSTALLATION has a Slack app configured, which decides
   * which delivery card renders: the one-click "Add to Slack" path, or the
   * pasted-token form as the primary path.
   *
   * SERVER-COMPUTED, AND THE CLIENT NEVER READS ENV. `SLACK_CLIENT_ID` is a
   * server variable, so `process.env.SLACK_CLIENT_ID` in a `"use client"`
   * component is `undefined` in the browser — the card would hide the OAuth
   * button from exactly the deployments that did configure a Slack app, which
   * is worse than not shipping it.
   *
   * Nothing about one organization is in this answer. It is a property of the
   * deployment, identical for every caller, and it carries no tenancy.
   */
  readonly slackOAuthAvailable: boolean;
};

export interface BuildFirstRunStatusInput {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly projectId: string;
  /** The milestones, already read. */
  readonly facts: StagePersistedFacts;
  /** See `FirstRunStatusPayload.findingUnavailable`. */
  readonly findingUnavailable: boolean;
}

/**
 * Assemble the payload from three reads, all org-scoped by construction.
 *
 * The three run CONCURRENTLY because none depends on another's answer, and a
 * poll that costs three round trips in series is three times the wait on the
 * one screen this product exists for.
 *
 * NO WALL-CLOCK VALUE IS PUT ON THIS WIRE. Elapsed time is computed by the
 * client from `armedAt`, which is a persisted origin — so two calls a
 * millisecond apart return byte-identical payloads, and `the route derives its
 * org from the session, never from the request` can compare two responses for
 * equality without a fixture freezing anything.
 */
export async function buildFirstRunStatus(
  input: BuildFirstRunStatusInput,
): Promise<FirstRunStatusPayload> {
  const { db, ctx, projectId, facts } = input;

  const [counter, slack, state] = await Promise.all([
    createEventsCounterService(db, ctx).read(projectId),
    createSlackConnectionsRepo(db, ctx).getActiveForOrg(),
    createFirstRunRepo(db, ctx).readState(projectId),
  ]);

  // THE NARROWING HAPPENS HERE AND ONLY HERE (AD-3). Everything downstream of
  // this line is holding an `OnboardingCounterView`, on which the wide
  // counter's duration field does not exist at all.
  const view = toOnboardingCounterView(counter);

  return {
    // ALREADY MAPPED AND VALIDATED by the status service's boundary parse
    // (AD-6). A row that failed it is `null` there with a logged reason; a
    // second parse here would be a second place for the two to disagree.
    finding: facts.finding,
    findingUnavailable: input.findingUnavailable,
    armedAt: facts.armedAt,
    // Returned AS-IS, both of them. `readingAt` can legitimately precede
    // `retrievedAt` — the hourly cron opens runs for reasons unrelated to this
    // founder's trigger — and the two things this must never do are swap them
    // so the story reads in the expected order, or null the earlier one
    // because it "cannot" have happened.
    retrievedAt: facts.retrievedAt,
    readingAt: facts.readingAt,
    endedAt: facts.endedAt,
    runStatus: facts.runStatus,
    runOutcome: facts.runOutcome,
    counter: view,
    connectionMessage: CONNECTION_STATE_MESSAGES[view.state.status],
    // FR-O13: read from the stored row, never accepted from a payload.
    // UNCHANGED BY AD-4 (row 1) — `channelId` means "the address", and a
    // channel-less row has none. `StepSequenceFacts.slackConnected` derives
    // from this and stays right for the same reason: step 3 is done when a
    // channel exists, not when a token does.
    channelId: slack?.channelId ?? null,
    slackSkippedAt: state?.slackSkippedAt ?? null,
    // AD-4 row 2, and the reader that breaks with no compile error anywhere.
    // The three states are distinguished because their next actions differ:
    // connect Slack at all / pick a channel / nothing to say.
    slackNotice: notice(slack),
    // AD-4 row 4. EXISTENCE, not address.
    slackWorkspaceAttached: slack !== null,
    slackWorkspaceName: slack?.workspaceName ?? null,
    // AD-6. Read here so no caller has to thread it (see the header's D11
    // block). `parseServerEnv` per call follows `resolveFirstRunDeps`, which
    // does the same per request rather than at module load — an env captured
    // at import time is one a redeploy cannot change.
    slackOAuthAvailable: slackOAuthConfigured(parseServerEnv(process.env)),
  };
}

/**
 * FR-O14's line, for the three states a Slack connection can be in.
 *
 * A FUNCTION RATHER THAN A TERNARY CHAIN INLINE, because the middle state is
 * the one that was missing and a named branch is harder to collapse back into
 * `slack === null` by somebody tidying up. Every sentence comes from the copy
 * home (FR-O22/B3); none is authored here.
 */
function notice(slack: { readonly channelId: string | null } | null): string | null {
  // No connection at all: the founder either skipped the step or has not
  // reached it. What is missing is Slack itself.
  if (slack === null) return SLACK_SKIPPED_NOTICE;

  // A workspace IS attached and there is still nowhere to post. Telling this
  // founder "connect Slack" would be false — they did — so they get the
  // sentence for the act that is actually outstanding.
  if (slack.channelId === null) return SLACK_CHANNEL_PICK_PROMPT;

  return null;
}

/**
 * The status an ACTION echoes back — arming, and skipping the Slack step.
 *
 * `findingUnavailable` is `false` here, and that is a statement about when
 * these two are pressed rather than a shortcut. Arming is the act that starts
 * the wait and skipping happens at step three; in both cases the run that
 * could produce a finding has not opened yet, so there is no row to fail to
 * render. THE POLL ROUTE IS THE AUTHORITY on that field, it answers within the
 * second, and it is the only caller that pays for the extra read.
 */
export async function echoFirstRunStatus(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<FirstRunStatusPayload> {
  const facts = await createFirstRunStatusService(db, ctx).read(projectId);
  return buildFirstRunStatus({ db, ctx, projectId, facts, findingUnavailable: false });
}
