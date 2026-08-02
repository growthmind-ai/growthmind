// THE FIVE STEPS, AND THE ONE ENGINE THAT SAYS WHERE THE FOUNDER IS STANDING
// (O-008, AD-19, FR-O3, FR-O15, FR-O23).
//
// ###########################################################################
// # THE `coming-next` ARM CARRIES NO `fields`, NO `actions` AND NO
// # `confirmations`, AND THAT ABSENCE IS THE CONTRACT.
// #
// # Two of the five steps ship as stubs. The failure everybody is trying to
// # avoid is a stub that LOOKS LIVE — a disabled connect field, a greyed
// # button, a "coming soon" pill with a tooltip explaining why it does not
// # work. Every one of those reads to a first-time founder as "this product is
// # broken", which is worse than an honest empty row.
// #
// # "Render nothing that could be mistaken for a live control" is not
// # enforceable by review, because the edit that breaks it always looks
// # helpful. So it lives in the type: the `coming-next` arm has NO PROPERTY A
// # CONTROL COULD BE BUILT FROM. A later edit that wants one has to WIDEN THE
// # UNION FIRST — a visible, reviewable act instead of a quiet one.
// #
// # `coming-next` is also a FIRST-CLASS member of the state union rather than
// # a flag beside it, so filling a stub later changes ONE DESCRIPTOR'S KIND
// # AND BODY: it renumbers nothing, widens no union, and re-lays out nothing.
// # A union that widens is a union every consumer's exhaustive switch stops
// # covering (FR-O23).
// ###########################################################################
//
// ── EVERY STRING COMES OFF `./messages` (B3, FR-O22) ────────────────────────
//
// This file authors no customer-facing sentence. It selects, orders and ranks
// what the copy home already says, so the plain-English audit over
// `ALL_ONBOARDING_MESSAGES` is total rather than best-effort — a sentence
// written here would reach a screen without ever passing that audit.
//
// ── STATE IS DERIVED, NEVER STORED (UX §3, binding) ─────────────────────────
//
// `StepSequenceFacts` carries persisted facts — connection rows, the skip
// fact, the arming stamp — and NOT step states. There is no per-step status
// column anywhere in this product, so the sequence cannot disagree with the
// rows it describes, and a reload cannot resurrect a state nothing recorded.

import { z } from "zod";

import type { ConnectRefusalCode, ConnectionStateStatus } from "../session-source/types";
import {
  CONNECT_ACTION_LABEL,
  DISCONNECT_ACTION_LABEL,
  FIELD_BOT_TOKEN_LABEL,
  FIELD_BOT_TOKEN_PLACEHOLDER,
  FIELD_CHANNEL_ID_HELPER,
  FIELD_CHANNEL_ID_LABEL,
  FIELD_CHANNEL_ID_PLACEHOLDER,
  FIELD_PERSONAL_KEY_HELPER,
  FIELD_PERSONAL_KEY_LABEL,
  FIELD_REGION_LABEL,
  FIELD_REGION_PREFILL,
  FIELD_SELF_HOST_DISCLOSURE,
  SEND_TEST_MESSAGE_LABEL,
  SKIP_FOR_NOW_LABEL,
  STEP_AGENT_FILLER,
  STEP_AGENT_TITLE,
  STEP_AGENT_WHAT_IT_WILL_DO,
  STEP_ANALYTICS_HELPER,
  STEP_ANALYTICS_TITLE,
  STEP_MOMENT_TITLE,
  STEP_REPO_FILLER,
  STEP_REPO_TITLE,
  STEP_REPO_WHAT_IT_WILL_DO,
  STEP_SLACK_HELPER,
  STEP_SLACK_TITLE,
} from "./messages";

// ---------------------------------------------------------------------------
// The two enums
// ---------------------------------------------------------------------------

/**
 * The five states a row can be in.
 *
 * `coming-next` sits beside the four a conventional wizard would have, and
 * that is the whole point (FR-O23): a stub is not a `pending` step that never
 * gets its turn, and it is certainly not `done`.
 */
export const stepStateSchema = z.enum(["pending", "active", "done", "skipped", "coming-next"]);
export type StepState = z.infer<typeof stepStateSchema>;

/**
 * The five identities, in ordinal order.
 *
 * THESE IDS OUTLIVE THE STUBS. O-013 fills `agent` and the fix-spec work fills
 * `repo`; neither may mint a new identity for a row that was already on screen,
 * because a renumbered sequence is the re-layout AD-19 was chosen to prevent.
 */
export const stepIdSchema = z.enum(["repo", "analytics", "slack", "agent", "moment"]);
export type StepId = z.infer<typeof stepIdSchema>;

/**
 * What a step confirms IN PLACE once it succeeds (UX §5: "success is always
 * shown in place, adjacent to its cause").
 *
 * SETTLED HERE, BECAUSE NO SOURCE NAMED THEM. The PRD fixes step 2's count
 * ("two confirmations — the counter, then the receipt") and UX row 15 gives
 * step 3 its one; the identifiers themselves were never written down, so they
 * are chosen here as an enum rather than left as a bare `string`. An enum means
 * a renderer's `switch` over them is exhaustive and a typo is a compile error
 * rather than a confirmation that silently never renders (D9).
 */
export const confirmationIdSchema = z.enum(["counter", "receipt", "test-message"]);
export type ConfirmationId = z.infer<typeof confirmationIdSchema>;

// ---------------------------------------------------------------------------
// The descriptor union
// ---------------------------------------------------------------------------

/**
 * One field on a work step.
 *
 * `disclosure` IS AN ADDITION BEYOND THE WAVE 0 MIRROR, AND IT IS DELIBERATE.
 * A folded field sits behind a collapsed disclosure whose own label is a
 * sentence, and that sentence is NOT the helper — a helper sits under a field,
 * a disclosure is the thing you press to reveal it. Folding that sentence into
 * `helper` would leave the renderer to infer "if folded, `helper` means
 * something else", which is exactly the kind of unwritten convention D11 says
 * gets severed. It is its own field, `null` on every visible one.
 */
export type FieldDescriptor = {
  readonly id: string;
  /** Normative copy — UX rows 5 and 12 state every label in bold. */
  readonly label: string;
  /** The sentence UNDER the field, or `null`. */
  readonly helper: string | null;
  /** The sentence you press to REVEAL a folded field. `null` when visible. */
  readonly disclosure: string | null;
  /** Rendered masked: the personal key and the bot token. */
  readonly secret: boolean;
  /** Behind the collapsed disclosure on first render. */
  readonly folded: boolean;
  readonly placeholder: string | null;
  /**
   * A starting VALUE, which the next submit will send. No field carries one
   * today: a field the product can fill in for you is a field it should not
   * have asked for, and the one field that used to be prefilled now shows its
   * shape as a `placeholder` instead, so an untouched field submits nothing.
   */
  readonly prefill: string | null;
  /**
   * The refusal codes this field is the subject of. UX row 6 puts focus on the
   * key field for `invalid_credentials`; UX row 7 auto-expands the address for
   * `unreachable`. ONE MECHANISM, TWO ROWS — a refusal that names a field the
   * founder cannot see is a dead end, and this is the wire that stops it.
   *
   * A code that is the subject of NO field is not a gap: `project_not_found`
   * belongs to no input now that the project is discovered rather than typed,
   * so it renders as the card's own sentence. That is the honest place for it.
   *
   * The renderer already holds the descriptor, so it derives the focus target
   * from what it has rather than from a second lookup somebody has to keep in
   * step (D11).
   */
  readonly refusalCodes: readonly ConnectRefusalCode[];
};

/**
 * One action on a work step. The rank is DATA rather than a render-time
 * decision, because UX §6 requires the primary first on mobile and a renderer
 * that decides ranking itself is a second opinion about which button matters.
 */
export type ActionDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly rank: "primary" | "secondary";
};

/** ADD AD-19's union, verbatim. Read the header before widening it. */
export type StepDescriptor =
  | {
      readonly kind: "coming-next";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly whatItWillDo: string;
      readonly filler: string;
    }
  //   ^ no `fields`, no `actions`, no `confirmations`. There is nothing to
  //     render as a control. This absence IS the FR-O3/FR-O15 contract.
  | {
      readonly kind: "work";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly helper: string;
      readonly fields: readonly FieldDescriptor[];
      readonly actions: readonly ActionDescriptor[];
      readonly confirmations: readonly ConfirmationId[];
      readonly skippable: boolean;
    }
  | {
      readonly kind: "stage";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
    };

/** The stub arm, named — the one renderer both stubs share reads this. */
export type ComingNextStep = Extract<StepDescriptor, { kind: "coming-next" }>;
/** The two steps with a form in them. */
export type WorkStep = Extract<StepDescriptor, { kind: "work" }>;
/** Step 5. The stage is not a form and never grows one. */
export type StageStep = Extract<StepDescriptor, { kind: "stage" }>;

// ---------------------------------------------------------------------------
// Step 2's fields — UX Checklist rows 5, 6 and 7
// ---------------------------------------------------------------------------

// ###########################################################################
// # THERE IS NO PROJECT-NUMBER FIELD, AND ITS DELETION IS THE STEP'S POINT.
// #
// # It used to be the first thing on this step: a text input for the vendor's
// # own project number, which a founder could only fill in by leaving the
// # product, opening the vendor's settings page and copying a number back. The
// # personal key alone tells us which projects it can read (AD-1), so the
// # number is discovered and then either auto-selected or picked from a list.
// #
// # IT MUST NOT COME BACK AS A DESCRIPTOR, NOT EVEN AN OPTIONAL ONE. This array
// # is what the form renders AND what a refusal is mapped onto; a field
// # declared here that the form does not render would take `project_not_found`
// # off the card and attach it to an input nobody can see, which is exactly the
// # dead end the refusal-to-field wire exists to prevent.
// ###########################################################################

const PERSONAL_KEY_FIELD: FieldDescriptor = {
  id: "personalKey",
  label: FIELD_PERSONAL_KEY_LABEL,
  helper: FIELD_PERSONAL_KEY_HELPER,
  disclosure: null,
  secret: true,
  folded: false,
  placeholder: null,
  prefill: null,
  refusalCodes: ["invalid_credentials"],
};

/**
 * THE EARNED FIELD. Folded, and not even offered until both hosted regions have
 * refused — so step 2 shows EXACTLY ONE VISIBLE FIELD and a founder on either
 * hosted region never meets an address question at all (AD-2).
 *
 * `folded` still means "behind its disclosure"; whether the disclosure is on
 * screen in the first place is the form's call, because only the form knows
 * whether a region walk has already come back empty. That is one fact, held
 * once, where it is observed.
 *
 * NOT PREFILLED, and the difference is behavioural rather than cosmetic. A
 * value sitting in this field is a value the next press SENDS, which takes the
 * single-request self-host branch at the very address that just refused and
 * skips the region walk the founder still needs. Empty means "walk the regions
 * again"; typed means "I have my own address". `FIELD_REGION_PREFILL` shows the
 * shape as a placeholder instead.
 */
const SELF_HOST_FIELD: FieldDescriptor = {
  id: "regionAddress",
  label: FIELD_REGION_LABEL,
  helper: null,
  disclosure: FIELD_SELF_HOST_DISCLOSURE,
  secret: false,
  folded: true,
  placeholder: FIELD_REGION_PREFILL,
  prefill: null,
  refusalCodes: ["unreachable"],
};

// NOTHING HERE ASKS FOR THE GROWTHMIND PROJECT ID. FR-O1 provisions it and
// AD-16 keeps it off every route's input schema; a field for it — even an
// "optional" one — would put the tenancy id back in the customer's hands
// through the front door.

// ---------------------------------------------------------------------------
// Step 3's fields — UX Checklist row 12
// ---------------------------------------------------------------------------
//
// `refusalCodes` is EMPTY on both. `ConnectRefusalCode` is the ANALYTICS
// connect vocabulary; a Slack test post fails with a `PostFailureCode` and is
// described by `./slack-test`, which speaks about the step rather than about
// one field. An empty array is the honest answer, not an oversight.

const BOT_TOKEN_FIELD: FieldDescriptor = {
  id: "botToken",
  label: FIELD_BOT_TOKEN_LABEL,
  helper: null,
  disclosure: null,
  secret: true,
  folded: false,
  placeholder: FIELD_BOT_TOKEN_PLACEHOLDER,
  prefill: null,
  refusalCodes: [],
};

const CHANNEL_ID_FIELD: FieldDescriptor = {
  id: "channelId",
  label: FIELD_CHANNEL_ID_LABEL,
  helper: FIELD_CHANNEL_ID_HELPER,
  disclosure: null,
  secret: false,
  folded: false,
  placeholder: FIELD_CHANNEL_ID_PLACEHOLDER,
  prefill: null,
  refusalCodes: [],
};

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

const CONNECT_ACTION: ActionDescriptor = {
  id: "connect",
  label: CONNECT_ACTION_LABEL,
  rank: "primary",
};

/**
 * Org-wide, and the confirmation says so (UX row 28). It rides on the step
 * rather than in a settings page nobody would find, because the row that
 * connected the account is the row a founder looks at to un-connect it.
 */
const DISCONNECT_ACTION: ActionDescriptor = {
  id: "disconnect",
  label: DISCONNECT_ACTION_LABEL,
  rank: "secondary",
};

const SEND_TEST_MESSAGE_ACTION: ActionDescriptor = {
  id: "sendTestMessage",
  label: SEND_TEST_MESSAGE_LABEL,
  rank: "primary",
};

/** Always present. A skip a founder cannot find is not a skip (deviation 2). */
const SKIP_SLACK_ACTION: ActionDescriptor = {
  id: "skipSlack",
  label: SKIP_FOR_NOW_LABEL,
  rank: "secondary",
};

// ---------------------------------------------------------------------------
// The five descriptors
// ---------------------------------------------------------------------------

/**
 * FROZEN, five elements, ordinals 1-5 with no gaps.
 *
 * A gap is a renumber waiting to happen, and a renumber is the one thing the
 * stub contract exists to make impossible.
 */
export const STEP_DESCRIPTORS: readonly StepDescriptor[] = Object.freeze([
  {
    kind: "coming-next",
    id: "repo",
    ordinal: 1,
    title: STEP_REPO_TITLE,
    whatItWillDo: STEP_REPO_WHAT_IT_WILL_DO,
    filler: STEP_REPO_FILLER,
  } satisfies StepDescriptor,
  {
    kind: "work",
    id: "analytics",
    ordinal: 2,
    title: STEP_ANALYTICS_TITLE,
    helper: STEP_ANALYTICS_HELPER,
    fields: [PERSONAL_KEY_FIELD, SELF_HOST_FIELD],
    actions: [CONNECT_ACTION, DISCONNECT_ACTION],
    // Two, in the order UX row 8 renders them: the counter, then the receipt.
    confirmations: ["counter", "receipt"],
    // THE ONE CONNECTION THE PRODUCT CANNOT WORK WITHOUT. The contrast with
    // step 3 is the reason `skippable` is data rather than a rule.
    skippable: false,
  } satisfies StepDescriptor,
  {
    kind: "work",
    id: "slack",
    ordinal: 3,
    title: STEP_SLACK_TITLE,
    helper: STEP_SLACK_HELPER,
    fields: [BOT_TOKEN_FIELD, CHANNEL_ID_FIELD],
    actions: [SEND_TEST_MESSAGE_ACTION, SKIP_SLACK_ACTION],
    confirmations: ["test-message"],
    skippable: true,
  } satisfies StepDescriptor,
  {
    kind: "coming-next",
    id: "agent",
    ordinal: 4,
    title: STEP_AGENT_TITLE,
    whatItWillDo: STEP_AGENT_WHAT_IT_WILL_DO,
    filler: STEP_AGENT_FILLER,
  } satisfies StepDescriptor,
  {
    kind: "stage",
    id: "moment",
    ordinal: 5,
    title: STEP_MOMENT_TITLE,
  } satisfies StepDescriptor,
]);

// ---------------------------------------------------------------------------
// The two partitions the screen renders — derived, never a second array
// ---------------------------------------------------------------------------
//
// ###########################################################################
// # THIS IS A VIEW OVER `STEP_DESCRIPTORS`, NOT A SECOND LIST OF STEPS.
// #
// # The screen stopped numbering the two stubs alongside the three live steps,
// # because "Connect your code — not built yet" was the first thing a founder
// # ever saw and the eye lands on row one. But the fix must not be a
// # hand-maintained second array: two lists of the same five steps disagree the
// # first time somebody edits one, and the disagreement is silent.
// #
// # So both partitions are COMPUTED from the frozen source. `STEP_DESCRIPTORS`
// # is untouched — still five, still ordinals 1-5 with no gaps, ids still
// # outliving the stubs. Filling a stub later moves it between these two
// # arrays by changing ONE DESCRIPTOR'S KIND, which is exactly the edit AD-19
// # was designed to make cheap.
// #
// # DISPLAY ORDINALS ARE NOT STORED ORDINALS. `descriptor.ordinal` is the
// # step's permanent identity within the five; `displayOrdinal` is what the
// # founder counts. Keeping them separate is what lets the screen show 1-2-3
// # without renumbering anything AD-19 pinned.
// ###########################################################################

/** The steps a founder can actually do, in order. Numbered on screen. */
export const LIVE_STEP_DESCRIPTORS: readonly StepDescriptor[] = Object.freeze(
  STEP_DESCRIPTORS.filter((descriptor) => descriptor.kind !== "coming-next"),
);

/** The stubs, in order. Rendered under the flow as a roadmap, never numbered. */
export const COMING_NEXT_DESCRIPTORS: readonly ComingNextStep[] = Object.freeze(
  STEP_DESCRIPTORS.filter(
    (descriptor): descriptor is ComingNextStep => descriptor.kind === "coming-next",
  ),
);

/** Display ordinal by id — 1-based over the live steps only. */
const DISPLAY_ORDINALS: ReadonlyMap<StepId, number> = new Map(
  LIVE_STEP_DESCRIPTORS.map((descriptor, index) => [descriptor.id, index + 1]),
);

/**
 * What the founder counts, which is not what the descriptor stores.
 *
 * Falls back to the stored ordinal for an id with no display position — a stub
 * asked for its display number is a caller error, and answering with the
 * stored ordinal is the honest, non-throwing answer rather than a zero that
 * would render as a row numbered nothing.
 */
export function displayOrdinal(id: StepId): number {
  return (
    DISPLAY_ORDINALS.get(id) ??
    STEP_DESCRIPTORS.find((descriptor) => descriptor.id === id)?.ordinal ??
    0
  );
}

// ---------------------------------------------------------------------------
// The facts the sequence is derived FROM
// ---------------------------------------------------------------------------

/**
 * Persisted facts, and nothing that is itself a step state.
 *
 * `reopenedReadOnly` is the one member that is not a row: UX row 25's re-open
 * is a client toggle ("not navigation — the URL never changes"). It is carried
 * HERE rather than left to the renderer because read-only must be checkable,
 * and the sequence engine is the only place that knows what "resolved state"
 * means (AD-1: there is no DOM runner to ask).
 */
export type StepSequenceFacts = {
  /** `null` when no connection row exists at all. */
  readonly connectionStatus: ConnectionStateStatus | null;
  readonly slackConnected: boolean;
  /** FR-O14: derived from the persisted absence of a connection, never a flag. */
  readonly slackSkipped: boolean;
  /** Flow D: a failed test post leaves step 3 active and NOT done. */
  readonly slackTestPostFailed: boolean;
  readonly armedAt: Date | null;
  /** UX row 25. See the note above. */
  readonly reopenedReadOnly: boolean;
};

/**
 * One step, as the sequence resolves it.
 *
 * `open` and `interactive` are separate on purpose. UX row 8 requires step 2 to
 * flip to done AND STAY OPEN — done-and-collapsed would throw away both
 * confirmations at the exact moment they are the proof the connection worked.
 * UX row 25 requires the re-opened sequence to render every step at its
 * resolved state with NO form re-opening. One field cannot say both.
 */
export type StepView = {
  readonly id: StepId;
  readonly ordinal: number;
  readonly state: StepState;
  /** The body renders. */
  readonly open: boolean;
  /** The body's controls accept input. False for every step when re-opened. */
  readonly interactive: boolean;
};

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The statuses that mean step 2's job is DONE.
 *
 * `failing` IS IN THIS SET, AND THAT IS A DECISION. The step's job is to attach
 * the account, and a failing connection is an attached one whose last check did
 * not land — `CONNECTION_STATE_MESSAGES.failing` says so, and it is rendered by
 * the counter that only a DONE step keeps on screen. Sending the step back to a
 * form would delete the very sentence explaining what went wrong.
 *
 * `disconnected` is the case that genuinely un-does the step, and it is the one
 * OQ-O7 and Flow F are about.
 */
const ATTACHED_STATUSES: ReadonlySet<ConnectionStateStatus> = new Set([
  "connected_never_polled",
  "connected_no_events_yet",
  "connected_receiving",
  "failing",
]);

/**
 * Whether the analytics account is attached, for any consumer that needs the
 * fact rather than the step state.
 *
 * EXPORTED SO `ATTACHED_STATUSES` KEEPS ONE HOME. The blocker chain and the
 * arm gate both need this exact question answered, and the failure mode if
 * they re-derive it is silent and asymmetric: a set that gains a member here
 * and not there leaves a founder whose connection is `failing` looking at a
 * step marked done above a panel still asking them to connect it. One set, one
 * predicate, three callers.
 */
export function isAnalyticsAttached(status: ConnectionStateStatus | null): boolean {
  return status !== null && ATTACHED_STATUSES.has(status);
}

/** `null` means unresolved — the step still has work in it. */
type WorkResolution = "done" | "skipped" | null;

function resolveAnalytics(facts: StepSequenceFacts): WorkResolution {
  return isAnalyticsAttached(facts.connectionStatus) ? "done" : null;
}

/**
 * Step 3, resolved.
 *
 * `slackTestPostFailed` IS DELIBERATELY NOT CONSULTED. A test post that failed
 * has proved nothing, so the step stays unresolved — and an unresolved step the
 * founder is standing on is `active` by the rule below, which is exactly what
 * Flow D asks for: not done, not an error, "Skip for now" still in the row.
 * Reading the flag here would be a second, competing definition of resolved.
 */
function resolveSlack(facts: StepSequenceFacts): WorkResolution {
  if (facts.slackConnected) return "done";
  // FR-O14 / deviation 2: skipping is a legitimate FINISHED answer. The step
  // settles; the honest degraded notice rides in the strip.
  if (facts.slackSkipped) return "skipped";
  return null;
}

/**
 * What an unresolved work step renders as.
 *
 * `active` IS "THE ROW YOU ARE STANDING ON", AND IT IS NOT AWARDED BACKWARDS.
 * A step re-opens as `pending` — a form, plainly there, not shouting — when the
 * sequence has already moved past it: a later step is resolved, or the founder
 * has armed the stage and is watching. That is Flow F: a teammate re-keying the
 * analytics connection must not yank a watching founder back to step 2, and
 * nothing else on the sequence may move because one connection changed.
 */
function unresolvedState(
  index: number,
  resolutions: readonly WorkResolution[],
  armedAt: Date | null,
): StepState {
  const anyEarlierUnresolved = resolutions
    .slice(0, index)
    .some((resolution) => resolution === null);
  const anyLaterResolved = resolutions.slice(index + 1).some((resolution) => resolution !== null);

  return !anyEarlierUnresolved && !anyLaterResolved && armedAt === null ? "active" : "pending";
}

/**
 * The sequence, derived.
 *
 * THE TWO STUBS ARE CONSTANT AND NEITHER ADVANCES NOR BLOCKS ANYTHING. They sit
 * at `coming-next` — not `pending`, which would read as "your turn", and not
 * `done`, which would be a fake success. The sequence stays completable THROUGH
 * them, so the MVP's one screen is reachable without two later outcomes.
 *
 * STEP 5 IS ALWAYS `active`. It is the stage — the live thing the founder came
 * for — and it is not a row that gets its turn and then gives it up. It is also
 * the reason nothing here reads `connectionStatus` for step 5: a disconnect
 * must never take a finding off the stage.
 */
export function deriveStepStates(facts: StepSequenceFacts): readonly StepView[] {
  // Index 0 is step 2 and index 1 is step 3 — the order the founder meets them,
  // which is the order `unresolvedState` reads to decide what "already moved
  // past" means.
  const resolutions: readonly WorkResolution[] = [resolveAnalytics(facts), resolveSlack(facts)];
  const workResolved = resolutions.every((resolution) => resolution !== null);

  // Keyed by `StepId` rather than computed from a position, so a sixth step
  // added to the union is a compile error here rather than a row that silently
  // renders as whatever the fallback was.
  const stateById: Record<StepId, StepState> = {
    repo: "coming-next",
    analytics: resolutions[0] ?? unresolvedState(0, resolutions, facts.armedAt),
    slack: resolutions[1] ?? unresolvedState(1, resolutions, facts.armedAt),
    agent: "coming-next",
    moment: "active",
  };

  return STEP_DESCRIPTORS.map((descriptor) => {
    // The stage's body opens once there is something to watch with, and stays
    // open for as long as the watch lasts — a disconnect mid-wait does not
    // close it, because what is on it already happened.
    const open = descriptor.kind === "stage" ? facts.armedAt !== null || workResolved : true;

    return {
      id: descriptor.id,
      ordinal: descriptor.ordinal,
      state: stateById[descriptor.id],
      open,
      // A stub has nothing to accept input with, and a re-opened sequence is a
      // RECORD of what happened — a control inside it would be a second,
      // competing place to change setup the founder has already finished,
      // sitting above a stage that is mid-wait.
      interactive: open && !facts.reopenedReadOnly && descriptor.kind !== "coming-next",
    };
  });
}
