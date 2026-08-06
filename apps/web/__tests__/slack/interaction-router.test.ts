import { FINDING_BLOCK_ID_PREFIX, GET_IT_FIXED_ACTION_ID } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { resolveSlackAction } from "../../lib/slack/interaction-router";

// TODO(Wave 1, ADD "Slack dismiss handler" section): import from "@growthmind/shared" once
// packages/shared/src/delivery/interaction-ids.ts defines it, beside GET_IT_FIXED_ACTION_ID.
const NOT_USEFUL_ACTION_ID = "growthmind.not_useful.v1";

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

  test("resolves NOT_USEFUL_ACTION_ID to a dismiss resolution, distinct from ignore", () => {
    // `resolveSlackAction`'s return type is still the pre-dismissal two-arm union (ADD "Slack
    // dismiss handler" section grows it to a 3-way union in Wave 1) — widened to `unknown` here
    // so this Wave 0 red is a real assertion failure, not a type error on a variant that does
    // not exist on the production type yet.
    const resolution: unknown = resolveSlackAction(NOT_USEFUL_ACTION_ID);

    expect(resolution).toEqual({ action: "dismiss" });
  });
});
