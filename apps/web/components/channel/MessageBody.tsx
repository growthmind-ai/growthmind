import { Box, Group, Stack, Text } from "@mantine/core";

import classes from "./channel.module.css";
import { inlineSpans, type InlineSpan } from "./inline";
import type { MessageBodyView } from "./view";

type KeyedSpan = InlineSpan & { readonly key: string };

// Keyed by where the span starts in its own block, which is unique and stable without
// standing in for the array index the lint rule refuses.
function keyed(text: string): readonly KeyedSpan[] {
  const out: KeyedSpan[] = [];
  let at = 0;

  for (const span of inlineSpans(text)) {
    out.push({ key: `${at}`, text: span.text, strong: span.strong });
    at += span.text.length;
  }

  return out;
}

function Line({ text, dimmed }: { readonly text: string; readonly dimmed: boolean }) {
  return (
    <Text
      size={dimmed ? "xs" : "sm"}
      {...(dimmed ? { c: "dimmed" } : {})}
      className={classes.messageText}
    >
      {keyed(text).map((span) => (
        <Text key={span.key} span inherit {...(span.strong ? { fw: 700 } : {})}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

export function MessageBody({ body }: { readonly body: MessageBodyView }) {
  if (body.kind === "absent") {
    return (
      <Box className={classes.absent} p="sm">
        <Text size="sm" c="dimmed">
          {body.note}
        </Text>
      </Box>
    );
  }

  return (
    <Stack gap="xs">
      {body.blocks.map((block) => (
        <Line key={block.key} text={block.text} dimmed={block.kind === "context"} />
      ))}

      {body.actionLabels.length === 0 ? null : (
        <Group gap="xs" mt={4} pt="xs" className={classes.slackActions}>
          {body.actionLabels.map((label) => (
            <Text key={label} size="xs" c="dimmed" className={classes.slackButton}>
              {label}
            </Text>
          ))}
          <Text size="xs" c="dimmed">
            — these are Slack&apos;s buttons, and they work there
          </Text>
        </Group>
      )}
    </Stack>
  );
}
