export type SlackActionResolution = { readonly action: "open_fix" } | { readonly action: "ignore" };

const NOT_IMPLEMENTED = "slack interaction router: resolveSlackAction is not implemented";

export function resolveSlackAction(actionId: string): SlackActionResolution {
  void actionId;
  throw new Error(NOT_IMPLEMENTED);
}
