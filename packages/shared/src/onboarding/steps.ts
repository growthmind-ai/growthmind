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
  FIELD_PERSONAL_KEY_PLACEHOLDER,
  FIELD_REGION_LABEL,
  FIELD_REGION_PREFILL,
  FIELD_SELF_HOST_DISCLOSURE,
  SEND_TEST_MESSAGE_LABEL,
  SKIP_FOR_NOW_LABEL,
  STEP_AGENT_HELPER,
  STEP_AGENT_TITLE,
  STEP_ANALYTICS_HELPER,
  STEP_ANALYTICS_TITLE,
  STEP_MOMENT_TITLE,
  STEP_REPO_TITLE,
  STEP_REPO_WHAT_IT_WILL_DO,
  STEP_SLACK_HELPER,
  STEP_SLACK_TITLE,
} from "./messages";
import type { ProviderRail } from "./providers";

export const stepStateSchema = z.enum(["pending", "active", "done", "skipped", "coming-next"]);
export type StepState = z.infer<typeof stepStateSchema>;

export const stepIdSchema = z.enum(["repo", "analytics", "slack", "agent", "moment"]);
export type StepId = z.infer<typeof stepIdSchema>;

export const confirmationIdSchema = z.enum(["counter", "receipt", "test-message"]);
export type ConfirmationId = z.infer<typeof confirmationIdSchema>;

export type FieldDescriptor = {
  readonly id: string;

  readonly label: string;

  readonly helper: string | null;

  readonly disclosure: string | null;

  readonly secret: boolean;

  readonly folded: boolean;
  readonly placeholder: string | null;
  // A starting VALUE, which the next submit sends. No field carries one today.
  readonly prefill: string | null;
  // The refusal codes this field is the subject of — the wire that lets a refusal
  // focus or expand the field it names. A code that is the subject of no field
  // (`project_not_found`) renders as the card's own sentence instead.
  readonly refusalCodes: readonly ConnectRefusalCode[];
};

export type ActionDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly rank: "primary" | "secondary";
};

export type StepDescriptor =
  | {
      readonly kind: "coming-next";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly whatItWillDo: string;
      // The soon card derives its chips from the catalogue by rail — no
      // hand-passed provider list (AD-8, D11).
      readonly rail: ProviderRail;
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
      readonly kind: "panel";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
      readonly helper: string;
    }
  //   ^ no `fields`, no `actions`, no `confirmations`: the panel owns its own
  //     controls (O-026 D-9), and that absence is the contract.
  | {
      readonly kind: "stage";
      readonly id: StepId;
      readonly ordinal: number;
      readonly title: string;
    };

export type ComingNextStep = Extract<StepDescriptor, { kind: "coming-next" }>;

export type WorkStep = Extract<StepDescriptor, { kind: "work" }>;

export type PanelStep = Extract<StepDescriptor, { kind: "panel" }>;

export type StageStep = Extract<StepDescriptor, { kind: "stage" }>;

// There is deliberately no project-number field: the personal key alone tells us
// which projects it can read (AD-1). It must not come back even as an optional
// descriptor — this array is both what the form renders and what refusals map
// onto, so a declared-but-unrendered field would attach `project_not_found` to an
// input nobody can see.

const PERSONAL_KEY_FIELD: FieldDescriptor = {
  id: "personalKey",
  label: FIELD_PERSONAL_KEY_LABEL,
  helper: FIELD_PERSONAL_KEY_HELPER,
  disclosure: null,
  secret: true,
  folded: false,
  placeholder: FIELD_PERSONAL_KEY_PLACEHOLDER,
  prefill: null,
  refusalCodes: ["invalid_credentials"],
};

// Earned: folded, and not offered until both hosted regions have refused (AD-2).
// Deliberately NOT prefilled — a value sitting here is a value the next press
// sends, taking the single-request self-host branch and skipping the region walk.
// Empty means "walk the regions again"; `FIELD_REGION_PREFILL` is the placeholder.
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

// Named separately from the step because the connection card is mounted on two
// surfaces — the setup step, and the settings page that outlives it.
export const SLACK_CONNECTION_FIELDS: readonly FieldDescriptor[] = Object.freeze([
  BOT_TOKEN_FIELD,
  CHANNEL_ID_FIELD,
]);

const CONNECT_ACTION: ActionDescriptor = {
  id: "connect",
  label: CONNECT_ACTION_LABEL,
  rank: "primary",
};

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

const SKIP_SLACK_ACTION: ActionDescriptor = {
  id: "skipSlack",
  label: SKIP_FOR_NOW_LABEL,
  rank: "secondary",
};

export const STEP_DESCRIPTORS: readonly StepDescriptor[] = Object.freeze([
  {
    kind: "coming-next",
    id: "repo",
    ordinal: 1,
    title: STEP_REPO_TITLE,
    whatItWillDo: STEP_REPO_WHAT_IT_WILL_DO,
    rail: "code",
  } satisfies StepDescriptor,
  {
    kind: "work",
    id: "analytics",
    ordinal: 2,
    title: STEP_ANALYTICS_TITLE,
    helper: STEP_ANALYTICS_HELPER,
    fields: [PERSONAL_KEY_FIELD, SELF_HOST_FIELD],
    actions: [CONNECT_ACTION, DISCONNECT_ACTION],

    confirmations: ["counter", "receipt"],

    skippable: false,
  } satisfies StepDescriptor,
  {
    kind: "work",
    id: "slack",
    ordinal: 3,
    title: STEP_SLACK_TITLE,
    helper: STEP_SLACK_HELPER,
    fields: SLACK_CONNECTION_FIELDS,
    actions: [SEND_TEST_MESSAGE_ACTION, SKIP_SLACK_ACTION],
    confirmations: ["test-message"],
    skippable: true,
  } satisfies StepDescriptor,
  {
    kind: "panel",
    id: "agent",
    ordinal: 4,
    title: STEP_AGENT_TITLE,
    helper: STEP_AGENT_HELPER,
  } satisfies StepDescriptor,
  {
    kind: "stage",
    id: "moment",
    ordinal: 5,
    title: STEP_MOMENT_TITLE,
  } satisfies StepDescriptor,
]);

export const LIVE_STEP_DESCRIPTORS: readonly StepDescriptor[] = Object.freeze(
  STEP_DESCRIPTORS.filter((descriptor) => descriptor.kind !== "coming-next"),
);

export const COMING_NEXT_DESCRIPTORS: readonly ComingNextStep[] = Object.freeze(
  STEP_DESCRIPTORS.filter(
    (descriptor): descriptor is ComingNextStep => descriptor.kind === "coming-next",
  ),
);

const DISPLAY_ORDINALS: ReadonlyMap<StepId, number> = new Map(
  LIVE_STEP_DESCRIPTORS.map((descriptor, index) => [descriptor.id, index + 1]),
);

// Named, because the settings page mounts the analytics form outside any step sequence and
// finding it by predicate there would hand every caller a `WorkStep | undefined` to widen.
export const ANALYTICS_STEP: WorkStep = (() => {
  const step = STEP_DESCRIPTORS.find(
    (descriptor): descriptor is WorkStep =>
      descriptor.kind === "work" && descriptor.id === "analytics",
  );
  if (step === undefined) {
    throw new Error("steps: no work step is declared for analytics");
  }
  return step;
})();

export const SLACK_STEP: WorkStep = (() => {
  const step = STEP_DESCRIPTORS.find(
    (descriptor): descriptor is WorkStep => descriptor.kind === "work" && descriptor.id === "slack",
  );
  if (step === undefined) {
    throw new Error("steps: no work step is declared for slack");
  }
  return step;
})();

export function displayOrdinal(id: StepId): number {
  return (
    DISPLAY_ORDINALS.get(id) ??
    STEP_DESCRIPTORS.find((descriptor) => descriptor.id === id)?.ordinal ??
    0
  );
}

export type StepSequenceFacts = {
  readonly connectionStatus: ConnectionStateStatus | null;
  readonly slackConnected: boolean;

  readonly slackSkipped: boolean;

  readonly slackTestPostFailed: boolean;

  readonly agentConnected: boolean;
  readonly armedAt: Date | null;

  readonly reopenedReadOnly: boolean;
};

export type StepView = {
  readonly id: StepId;
  readonly ordinal: number;
  readonly state: StepState;

  readonly open: boolean;

  readonly interactive: boolean;
};

const ATTACHED_STATUSES: ReadonlySet<ConnectionStateStatus> = new Set([
  "connected_never_polled",
  "connected_no_events_yet",
  "connected_receiving",
  "failing",
]);

export function isAnalyticsAttached(status: ConnectionStateStatus | null): boolean {
  return status !== null && ATTACHED_STATUSES.has(status);
}

export type StepResolution = "done" | "skipped" | null;

// Self-describing rather than positional: inserting a step into a positional
// array shifts every index that reads it, and the agent step would have started
// gating the stage in silence (O-026 D-9).
type ResolvedStep = {
  readonly id: StepId;
  readonly resolution: StepResolution;
  // The stage opens on the steps a founder must finish before a run can say
  // anything. A coding assistant is not one of them.
  readonly gatesStage: boolean;
};

function resolveAnalytics(facts: StepSequenceFacts): StepResolution {
  return isAnalyticsAttached(facts.connectionStatus) ? "done" : null;
}

function resolveSlack(facts: StepSequenceFacts): StepResolution {
  if (facts.slackConnected) return "done";

  if (facts.slackSkipped) return "skipped";
  return null;
}

// No "skipped": a founder who connects no assistant has not skipped this step,
// they have not done it.
function resolveAgent(facts: StepSequenceFacts): StepResolution {
  return facts.agentConnected ? "done" : null;
}

function stepResolutions(facts: StepSequenceFacts): readonly ResolvedStep[] {
  return [
    { id: "analytics", resolution: resolveAnalytics(facts), gatesStage: true },
    { id: "slack", resolution: resolveSlack(facts), gatesStage: true },
    { id: "agent", resolution: resolveAgent(facts), gatesStage: false },
  ];
}

function unresolvedState(
  index: number,
  resolutions: readonly ResolvedStep[],
  armedAt: Date | null,
): StepState {
  const anyEarlierUnresolved = resolutions
    .slice(0, index)
    .some((entry) => entry.resolution === null);
  const anyLaterResolved = resolutions.slice(index + 1).some((entry) => entry.resolution !== null);

  return !anyEarlierUnresolved && !anyLaterResolved && armedAt === null ? "active" : "pending";
}

function stateOf(descriptor: StepDescriptor, walked: ReadonlyMap<StepId, StepState>): StepState {
  if (descriptor.kind === "coming-next") return "coming-next";
  if (descriptor.kind === "stage") return "active";
  return walked.get(descriptor.id) ?? "pending";
}

export function deriveStepStates(facts: StepSequenceFacts): readonly StepView[] {
  const resolutions = stepResolutions(facts);

  const walked: ReadonlyMap<StepId, StepState> = new Map(
    resolutions.map((entry, index) => [
      entry.id,
      entry.resolution ?? unresolvedState(index, resolutions, facts.armedAt),
    ]),
  );

  const stageOpen =
    facts.armedAt !== null ||
    resolutions.every((entry) => !entry.gatesStage || entry.resolution !== null);

  return STEP_DESCRIPTORS.map((descriptor) => {
    const open = descriptor.kind === "stage" ? stageOpen : true;

    return {
      id: descriptor.id,
      ordinal: descriptor.ordinal,
      state: stateOf(descriptor, walked),
      open,

      interactive: open && !facts.reopenedReadOnly && descriptor.kind !== "coming-next",
    };
  });
}
