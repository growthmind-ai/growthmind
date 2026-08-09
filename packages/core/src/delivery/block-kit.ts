import type { PostRequest } from "@growthmind/shared";

import { escapeMrkdwn } from "./mrkdwn";
import type { SlackAction, SlackActionsBlock, SlackBlock } from "./slack-message";

function buttonOf(action: SlackAction): unknown {
  return {
    type: "button",
    action_id: action.actionId,
    value: action.value,
    text: { type: "plain_text", text: action.label },
    ...(action.style === null ? {} : { style: action.style }),
  };
}

function actionsOf(block: SlackActionsBlock): unknown {
  return {
    type: "actions",
    block_id: block.blockId,
    elements: block.actions.map(buttonOf),
  };
}

export function toBlockKit(blocks: readonly SlackBlock[]): unknown[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case "section":
        return { type: "section", text: { type: "mrkdwn", text: escapeMrkdwn(block.text) } };
      case "context":
        return {
          type: "context",
          elements: [{ type: "mrkdwn", text: escapeMrkdwn(block.text) }],
        };
      case "actions":
        return actionsOf(block);
    }
  });
}

export interface PostRequestInput {
  readonly channelId: string;
  readonly blocks: readonly SlackBlock[];
  readonly fallbackText: string;
}

// Every field the poster sends is built here, because Slack mrkdwn-parses `text` as well as each
// section body — it is the notification preview, the sidebar entry, the search result, and what
// a client ignoring blocks renders. Escaping only the blocks left the same payload on the wire.
export function toPostRequest(input: PostRequestInput): PostRequest {
  return {
    channelId: input.channelId,
    blocks: toBlockKit(input.blocks),
    fallbackText: escapeMrkdwn(input.fallbackText),
  };
}
