import type { SlackBlock } from "./slack-message";

const NOT_IMPLEMENTED = "block-kit: toBlockKit is not implemented";

export function toBlockKit(blocks: readonly SlackBlock[]): unknown[] {
  void blocks;
  throw new Error(NOT_IMPLEMENTED);
}
