import { GET_IT_FIXED_ACTION_ID } from "@growthmind/shared";

export type SlackActionResolution = { readonly action: "open_fix" } | { readonly action: "ignore" };

const OPEN_FIX: SlackActionResolution = { action: "open_fix" };

const IGNORE: SlackActionResolution = { action: "ignore" };

export function resolveSlackAction(actionId: string): SlackActionResolution {
  return actionId === GET_IT_FIXED_ACTION_ID ? OPEN_FIX : IGNORE;
}
