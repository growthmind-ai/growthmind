import { describe, expect, test } from "bun:test";

import {
  SHIPPED_ALREADY_ANSWERED_TEMPLATE,
  SHIPPED_LEAD_REACH_ACTION_ID,
  SHIPPED_LEAD_REPEAT_ACTION_ID,
  SHIPPED_LEAD_TOO_LATE_REFUSAL,
  SHIPPED_PROMISE_TEMPLATE,
  SHIPPED_UNVERIFIED_LINE,
} from "@growthmind/shared";

import { fill } from "../../src/replay-filters/template";
import {
  renderShippedAcknowledgement,
  shippedAlreadyAnsweredBody,
  shippedClockUnchangedBody,
  shippedPromiseBody,
} from "../../src/shipped/acknowledgement";

const CHANGE_ID = "3f2b7c18-9a44-4d21-8f60-1c0de9b7a512";

const READOUT_DUE_AT = new Date("2026-08-23T09:00:00.000Z");

function acknowledgement() {
  return renderShippedAcknowledgement({
    changeId: CHANGE_ID,
    change: "CSV export",
    page: "/reports",
    readoutDueAt: READOUT_DUE_AT,
  });
}

const PROMISE = {
  change: "CSV export",
  page: "/reports",
  readoutDueAt: READOUT_DUE_AT,
};

describe("a change told again gets the date it already has, never a second promise", () => {
  test("should name the date and say it has not moved", () => {
    const body = shippedClockUnchangedBody(PROMISE);

    expect(body).toContain("23 August");
    expect(body).toContain("CSV export");
    expect(body).toContain("/reports");
  });

  test("should not repeat the sentence that promises an answer", () => {
    // The first report's sentence is what makes the forecast; saying it twice reads as a second
    // clock on a change that only has one.
    expect(shippedClockUnchangedBody(PROMISE)).not.toBe(shippedPromiseBody(PROMISE));
    expect(shippedClockUnchangedBody(PROMISE)).not.toContain(SHIPPED_PROMISE_TEMPLATE.slice(0, 20));
  });
});

describe("a change told again after it was answered is turned down, not acknowledged", () => {
  test("should say the answer has already been given", () => {
    const body = shippedAlreadyAnsweredBody(PROMISE);

    expect(body).toBe(
      fill(SHIPPED_ALREADY_ANSWERED_TEMPLATE, {
        change: PROMISE.change,
        page: PROMISE.page,
        date: "23 August",
      }),
    );
    expect(body).toContain("23 August");

    // The metric-change refusal is about what a change is judged on, not about whether it has
    // been answered; composing the two read as a promise for a date already gone.
    expect(body).not.toContain(SHIPPED_LEAD_TOO_LATE_REFUSAL);
  });

  test("should not read like the acknowledgement a first report gets", () => {
    expect(shippedAlreadyAnsweredBody(PROMISE)).not.toBe(shippedPromiseBody(PROMISE));
    expect(shippedAlreadyAnsweredBody(PROMISE)).not.toBe(shippedClockUnchangedBody(PROMISE));
  });
});

describe("the promise is made at report time", () => {
  test("should name the date the answer lands, in the founder's own calendar words", () => {
    expect(acknowledgement().body).toContain("23 August");
  });

  test("should state that nobody read their code, rather than implying the change was verified", () => {
    expect(acknowledgement().body).toContain(SHIPPED_UNVERIFIED_LINE);
  });

  test("should offer both counts as the one that can lead, and nothing else", () => {
    const actions = acknowledgement().actions;

    expect(actions.map((action) => action.actionId)).toEqual([
      SHIPPED_LEAD_REACH_ACTION_ID,
      SHIPPED_LEAD_REPEAT_ACTION_ID,
    ]);
  });

  test("should carry the change id only where Slack does not render it", () => {
    const rendered = acknowledgement();

    expect(rendered.body).not.toContain(CHANGE_ID);
    expect(rendered.actions.every((action) => action.value === CHANGE_ID)).toBe(true);
  });

  test("should leave no template token unfilled", () => {
    expect(acknowledgement().body).not.toMatch(/\{\w+\}/);
  });

  test("should say the same thing on a surface with no buttons to press", () => {
    expect(
      shippedPromiseBody({
        change: "CSV export",
        page: "/reports",
        readoutDueAt: READOUT_DUE_AT,
      }),
    ).toBe(acknowledgement().body);
  });
});
