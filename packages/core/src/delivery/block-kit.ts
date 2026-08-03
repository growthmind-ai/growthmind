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
        return { type: "section", text: { type: "mrkdwn", text: block.text } };
      case "context":
        return { type: "context", elements: [{ type: "mrkdwn", text: block.text }] };
      case "actions":
        return actionsOf(block);
    }
  });
}
