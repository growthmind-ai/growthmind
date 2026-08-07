"use client";

import { Box, Collapse, Group, Stack, Text } from "@mantine/core";
import { useId, useState } from "react";

import { SurfaceCard } from "@/components/ui/SurfaceCard";

import classes from "./channel.module.css";
import type { LaneHistoryRow, LaneLine, LaneTone } from "./lane";

const DOT: Record<LaneTone, string> = { quiet: "band.4", alarm: "red.7", cold: "gray.6" };

const BACKGROUND: Record<LaneTone, { readonly bg?: string }> = {
  quiet: {},
  alarm: { bg: "var(--mantine-color-red-light)" },
  cold: {},
};

interface LaneStatusProps {
  readonly line: LaneLine;
  readonly history: readonly LaneHistoryRow[];
}

// The lane's current answer is always the visible one; the runs behind it sit under the same
// measured disclosure a receipt uses, so this page has one interaction rather than two.
export function LaneStatus({ line, history }: LaneStatusProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <SurfaceCard {...BACKGROUND[line.tone]} className={classes.lane} data-tone={line.tone}>
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <Box className={classes.dot} bg={DOT[line.tone]} mt={6} />

        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} {...(line.tone === "alarm" ? { c: "red.6" } : {})}>
            {line.head}
          </Text>
          <Text size="xs" c="dimmed">
            {line.body}
          </Text>

          {history.length === 0 ? null : (
            <Box>
              <button
                type="button"
                className={classes.disclosure}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => {
                  setOpen((was) => !was);
                }}
              >
                <Text component="span" size="xs" inherit>
                  {open ? "Hide what it has been doing" : "What it has been doing →"}
                </Text>
              </button>

              <Collapse
                expanded={open}
                transitionDuration={260}
                transitionTimingFunction="cubic-bezier(0.22, 0.7, 0.24, 1)"
              >
                <Stack gap={6} id={panelId} pt="xs">
                  {history.map((run) => (
                    <Group key={run.key} gap="sm" align="flex-start" wrap="nowrap">
                      <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: "nowrap" }}>
                        {run.when}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {run.what}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )}
        </Stack>
      </Group>
    </SurfaceCard>
  );
}
