"use client";

import { Anchor, Badge, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";

import type { ReplayListRow } from "@growthmind/core";
import { REPLAY_SIMULATED_BADGE } from "@growthmind/shared";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { timeOnPage } from "@/lib/replay/label";
import { ROUTES } from "@/lib/routes";

const STARTED_AT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

// null is unmeasured and renders nothing; 0 is a measurement and renders its badge. Coalescing
// the two would report a session nobody measured as one where nothing happened.
function count(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function plural(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}s`;
}

export function ReplayRow({ row }: { row: ReplayListRow }) {
  // Wall-clock counts the tab someone left open; active time does not.
  const time = timeOnPage(row);
  const clicks = count(row.clickCount);
  const typed = count(row.keypressCount);
  const errors = count(row.consoleErrorCount);

  return (
    <Link
      href={`${ROUTES.replays}/${row.recordingId}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <SurfaceCard style={row.lane === "real" ? undefined : { borderStyle: "dashed" }}>
        <Group justify="space-between" gap="md" wrap="wrap" align="flex-start">
          <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
            <Anchor component="span" fw={600} truncate="end">
              {row.entryUrlPath ?? row.recordingId}
            </Anchor>

            {/* Formatted in the viewer's timezone rather than the server's: this is a client
                component, so the pre-render is replaced instead of reconciled. */}
            <Text size="xs" c="dimmed" suppressHydrationWarning>
              {new Date(row.startedAt).toLocaleString(undefined, STARTED_AT_FORMAT)}
              {row.companyDomain === null ? null : ` · ${row.companyDomain}`}
              {time?.total == null ? null : ` · ${time.total} on the page`}
            </Text>
          </Stack>

          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {time === null ? null : (
              <Badge variant="light" color="gray">
                {time.badge}
              </Badge>
            )}
            {clicks === null ? null : (
              <Badge variant="light" color="gray">
                {plural(clicks, "click")}
              </Badge>
            )}
            {typed === null ? null : (
              <Badge variant="light" color="gray">
                {plural(typed, "keystroke")}
              </Badge>
            )}
            {errors === null ? null : (
              <Badge variant="light" color="red">
                {plural(errors, "error")}
              </Badge>
            )}
            {row.lane === "simulated" ? (
              <Badge variant="light" color="gray">
                {REPLAY_SIMULATED_BADGE}
              </Badge>
            ) : null}
            {row.exclusionLabel === null ? null : (
              <Badge variant="light" color="gray">
                {row.exclusionLabel}
              </Badge>
            )}
          </Group>
        </Group>
      </SurfaceCard>
    </Link>
  );
}
