import { Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import type { StepState } from "@growthmind/shared";

const ORDINAL_COLUMN = { width: 20, flexShrink: 0 };

const CONTENT_COLUMN = { flex: 1, minWidth: 0 };

const STATE_GLYPH: Partial<Record<StepState, string>> = {
  done: "✓",
  skipped: "·",
};

interface StepRowProps {
  readonly ordinal: number;
  readonly title: string;

  readonly helper?: string | null;
  readonly state: StepState;

  readonly open: boolean;
  readonly children?: ReactNode;
}

export function StepRow(props: StepRowProps) {
  const { ordinal, title, helper } = props;
  const { state, open, children } = props;
  const glyph = STATE_GLYPH[state];

  return (
    <Paper withBorder radius="sm" p="md">
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <Text c="dimmed" fw={700} aria-hidden style={ORDINAL_COLUMN}>
          {ordinal}
        </Text>
        <Stack gap="xs" style={CONTENT_COLUMN}>
          <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
            <Text fw={700}>{title}</Text>
            {glyph === undefined ? null : (
              <Text c={state === "done" ? "band.4" : "dimmed"} fw={700} aria-hidden>
                {glyph}
              </Text>
            )}
          </Group>
          {helper === null || helper === undefined ? null : (
            <Text c="dimmed" size="sm">
              {helper}
            </Text>
          )}
          {open ? children : null}
        </Stack>
      </Group>
    </Paper>
  );
}
