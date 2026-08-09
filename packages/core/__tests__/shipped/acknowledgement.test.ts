import { describe, expect, test } from "bun:test";

import {
  SHIPPED_LEAD_REACH_ACTION_ID,
  SHIPPED_LEAD_REPEAT_ACTION_ID,
  SHIPPED_UNVERIFIED_LINE,
} from "@growthmind/shared";

import {
  renderShippedAcknowledgement,
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
