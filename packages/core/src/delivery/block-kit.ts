import type { SlackAction, SlackActionsBlock, SlackBlock } from "./slack-message";

// Slack's own three, ampersand first so an escape is never escaped twice. Applied to every
// mrkdwn body because caller free text reaches one: `<https://x|Reset your password>` renders as
// a live link and `<!channel>` as a broadcast, in Growthmind's voice, with no human in the loop.
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

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
