import { GET_IT_FIXED_ACTION_ID, NOT_USEFUL_ACTION_ID } from "@growthmind/shared";

export type SlackActionResolution =
  { readonly action: "open_fix" } | { readonly action: "dismiss" } | { readonly action: "ignore" };

const OPEN_FIX: SlackActionResolution = { action: "open_fix" };

const DISMISS: SlackActionResolution = { action: "dismiss" };

const IGNORE: SlackActionResolution = { action: "ignore" };

export function resolveSlackAction(actionId: string): SlackActionResolution {
  if (actionId === GET_IT_FIXED_ACTION_ID) return OPEN_FIX;
  if (actionId === NOT_USEFUL_ACTION_ID) return DISMISS;
  return IGNORE;
}
