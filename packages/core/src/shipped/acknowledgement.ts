import {
  SHIPPED_ALREADY_ANSWERED_TEMPLATE,
  SHIPPED_CLOCK_UNCHANGED_TEMPLATE,
  SHIPPED_LEAD_OFFER_LINE,
  SHIPPED_LEAD_REACH_ACTION_ID,
  SHIPPED_LEAD_REACH_LABEL,
  SHIPPED_LEAD_REPEAT_ACTION_ID,
  SHIPPED_LEAD_REPEAT_LABEL,
  SHIPPED_NOTED_TEMPLATE,
  SHIPPED_PROMISE_TEMPLATE,
  SHIPPED_STOPPED_WATCHING_TEMPLATE,
  SHIPPED_UNVERIFIED_LINE,
  SHIPPED_WATCHING_AGAIN_TEMPLATE,
} from "@growthmind/shared";

import { fill } from "../replay-filters/template";
import type { ShippedReadoutAction } from "./readout";

export type ShippedAcknowledgement = {
  readonly body: string;
  readonly actions: readonly ShippedReadoutAction[];
};

export type ShippedChangeNaming = {
  readonly change: string;
  readonly page: string;
};

export type ShippedPromise = ShippedChangeNaming & {
  readonly readoutDueAt: Date;
};

export type ShippedAcknowledgementInput = ShippedPromise & {
  readonly changeId: string;
};

// en-GB in UTC, so the date the founder reads is the date the clock actually runs to and not
// the date in whoever's timezone rendered it.
function dueDateLabel(due: Date): string {
  const day = due.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const month = due.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

  return `${day} ${month}`;
}

function leadActions(changeId: string): readonly ShippedReadoutAction[] {
  return [
    {
      actionId: SHIPPED_LEAD_REACH_ACTION_ID,
      label: SHIPPED_LEAD_REACH_LABEL,
      value: changeId,
    },
    {
      actionId: SHIPPED_LEAD_REPEAT_ACTION_ID,
      label: SHIPPED_LEAD_REPEAT_LABEL,
      value: changeId,
    },
  ];
}

// The promise is made before the window runs, which is what makes the readout gradeable later
// rather than a retrospective statistic. It says what is measured, when, and that nothing here
// checked the change is really live.
export function shippedPromiseBody(input: ShippedPromise): string {
  return [
    fill(SHIPPED_NOTED_TEMPLATE, { change: input.change, page: input.page }),
    fill(SHIPPED_PROMISE_TEMPLATE, { date: dueDateLabel(input.readoutDueAt) }),
    SHIPPED_UNVERIFIED_LINE,
    SHIPPED_LEAD_OFFER_LINE,
  ].join(" ");
}

function clockUnchangedSentence(input: ShippedPromise): string {
  return fill(SHIPPED_CLOCK_UNCHANGED_TEMPLATE, {
    change: input.change,
    page: input.page,
    date: dueDateLabel(input.readoutDueAt),
  });
}

// A second report of a change already on the clock. HC-2 makes it the same change, so the
// answer states the date rather than promising a new one.
export function shippedClockUnchangedBody(input: ShippedPromise): string {
  return clockUnchangedSentence(input);
}

// A report landing after the change was answered. The change key is fixed at page and control,
// so this can neither fork a row nor be given a date, and saying so beats a promise for a day
// that has gone.
export function shippedAlreadyAnsweredBody(input: ShippedPromise): string {
  return fill(SHIPPED_ALREADY_ANSWERED_TEMPLATE, {
    change: input.change,
    page: input.page,
    date: dueDateLabel(input.readoutDueAt),
  });
}

// Neither reason we stop watching for leaves a date the founder could check, so this names none.
export function shippedStoppedWatchingBody(input: ShippedChangeNaming): string {
  return fill(SHIPPED_STOPPED_WATCHING_TEMPLATE, {
    change: input.change,
    page: input.page,
  });
}

// A report landing on a change whose readout measured nothing. The change key is untouched and
// the row is the same one, so this states the new date rather than reading as a second change.
export function shippedWatchingAgainBody(input: ShippedPromise): string {
  return fill(SHIPPED_WATCHING_AGAIN_TEMPLATE, {
    change: input.change,
    page: input.page,
    date: dueDateLabel(input.readoutDueAt),
  });
}

export function renderShippedAcknowledgement(
  input: ShippedAcknowledgementInput,
): ShippedAcknowledgement {
  return { body: shippedPromiseBody(input), actions: leadActions(input.changeId) };
}
