import {
  GET_IT_FIXED_ACTION_ID,
  NOT_USEFUL_ACTION_ID,
  SHIPPED_LEAD_REACH_ACTION_ID,
  SHIPPED_LEAD_REPEAT_ACTION_ID,
  SHIPPED_VERDICT_KEEP_ACTION_ID,
  SHIPPED_VERDICT_KILL_ACTION_ID,
  SHIPPED_VERDICT_LEAVE_ACTION_ID,
  type ShippedLeadCount,
  type ShippedVerdict,
} from "@growthmind/shared";

export type SlackActionResolution =
  | { readonly action: "open_fix" }
  | { readonly action: "dismiss" }
  | { readonly action: "verdict"; readonly verdict: ShippedVerdict }
  | { readonly action: "lead_count"; readonly leadCount: ShippedLeadCount }
  | { readonly action: "ignore" };

const IGNORE: SlackActionResolution = { action: "ignore" };

// One action id per answer, so this stays an exact match with nothing to parse out of a value.
// A Map rather than an object, so an action id naming an inherited property resolves to ignore.
const ROUTED = new Map<string, SlackActionResolution>([
  [GET_IT_FIXED_ACTION_ID, { action: "open_fix" }],
  [NOT_USEFUL_ACTION_ID, { action: "dismiss" }],
  [SHIPPED_VERDICT_KEEP_ACTION_ID, { action: "verdict", verdict: "keep" }],
  [SHIPPED_VERDICT_KILL_ACTION_ID, { action: "verdict", verdict: "kill" }],
  [SHIPPED_VERDICT_LEAVE_ACTION_ID, { action: "verdict", verdict: "leave" }],
  [SHIPPED_LEAD_REACH_ACTION_ID, { action: "lead_count", leadCount: "reach" }],
  [SHIPPED_LEAD_REPEAT_ACTION_ID, { action: "lead_count", leadCount: "repeat" }],
]);

export function resolveSlackAction(actionId: string): SlackActionResolution {
  return ROUTED.get(actionId) ?? IGNORE;
}
