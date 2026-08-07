import { Paper, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface EmptyStateProps {
  readonly heading: string;
  readonly body: string;

  /** Exactly one control. A state that hands back no next action is a dead end. */
  readonly action: ReactNode;
}

export function EmptyState({ heading, body, action }: EmptyStateProps) {
  return (
    <Paper
      withBorder
      radius="sm"
      p="xl"
      bg="var(--mantine-color-default)"
      style={{ borderStyle: "dashed" }}
    >
      <Stack gap="sm" align="center" ta="center">
        <Title order={2} size="h4">
          {heading}
        </Title>

        <Text c="dimmed" style={{ maxWidth: "50ch" }}>
          {body}
        </Text>

        {action}
      </Stack>
    </Paper>
  );
}
