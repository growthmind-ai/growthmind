// THE ONE PAYLOAD THE WHOLE SURFACE RECONCILES AGAINST (O-008, AD-3, AD-6,
// AD-18).
//
// ###########################################################################
// # NOTHING HERE IS MINTED AND NOTHING IS HAND-PASSED (D11).
// #
// # Every field below is read from a row that already exists, by the consumer
// # that renders it. There is no producer computing a milestone and attaching
// # it to a response for a later surface to read — which is the shape whose
// # wire gets severed and whose "when present…" branch then never runs, with
// # producer tests and consumer tests both green.
// #
// #   armedAt / retrievedAt / readingAt / endedAt / runStatus / runOutcome
// #                       -> `createFirstRunStatusService(...).read(projectId)`
// #   counter             -> `createEventsCounterService(...).read(projectId)`
// #   channelId           -> the `slack_connections` row (FR-O13)
// #   slackSkippedAt      -> the `first_run_state` row
// #   finding             -> already mapped AND validated by the status
// #                          service's boundary parse. NOT RE-PARSED HERE.
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
// `skipped` is distinguishable from `pending` after a reload. THE ABSENCE OF
// AN ACTIVE CONNECTION drives the NOTICE, which is what makes the notice
// survive a reload AND a later disconnect by construction. A `slackConnected`
// boolean cached onto `first_run_state` would be the hand-passed wire this
// split exists to avoid — written by one path, read by another, and stale the
// moment anybody else disconnects.
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
  SLACK_SKIPPED_NOTICE,
  toOnboardingCounterView,
} from "@growthmind/shared";

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
  /** FR-O14, derived from the absence of an active connection. */
  readonly slackNotice: string | null;
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
    channelId: slack?.channelId ?? null,
    slackSkippedAt: state?.slackSkippedAt ?? null,
    slackNotice: slack === null ? SLACK_SKIPPED_NOTICE : null,
  };
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
