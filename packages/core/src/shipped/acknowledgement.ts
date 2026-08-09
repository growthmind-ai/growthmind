import {
  SHIPPED_LEAD_OFFER_LINE,
  SHIPPED_LEAD_REACH_ACTION_ID,
  SHIPPED_LEAD_REACH_LABEL,
  SHIPPED_LEAD_REPEAT_ACTION_ID,
  SHIPPED_LEAD_REPEAT_LABEL,
  SHIPPED_NOTED_TEMPLATE,
  SHIPPED_PROMISE_TEMPLATE,
  SHIPPED_UNVERIFIED_LINE,
} from "@growthmind/shared";

import { fill } from "../replay-filters/template";
import type { ShippedReadoutAction } from "./readout";

export type ShippedAcknowledgement = {
  readonly body: string;
  readonly actions: readonly ShippedReadoutAction[];
};

export type ShippedPromise = {
  readonly change: string;
  readonly page: string;
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

export function renderShippedAcknowledgement(
  input: ShippedAcknowledgementInput,
): ShippedAcknowledgement {
  return { body: shippedPromiseBody(input), actions: leadActions(input.changeId) };
}
