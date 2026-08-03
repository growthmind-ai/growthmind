import { FINDING_BLOCK_ID_PREFIX, GET_IT_FIXED_ACTION_ID } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { resolveSlackAction } from "../../lib/slack/interaction-router";

const NOT_OURS: readonly string[] = [
  "",
  "growthmind.get_it_fixed",
  "growthmind.get_it_fixed.v2",
  "GROWTHMIND.GET_IT_FIXED.V1",
  `${GET_IT_FIXED_ACTION_ID} `,
  FINDING_BLOCK_ID_PREFIX,
  "button",
  "not.a.growthmind.action",
];

describe("resolveSlackAction", () => {
  test("routes only the actions it declares", () => {
    expect(resolveSlackAction(GET_IT_FIXED_ACTION_ID)).toEqual({ action: "open_fix" });

    for (const actionId of NOT_OURS) {
      expect({ actionId, ...resolveSlackAction(actionId) }).toEqual({
        actionId,
        action: "ignore",
      });
    }
  });
});
