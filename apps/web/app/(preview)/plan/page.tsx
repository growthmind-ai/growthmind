import {
  Box,
  Group,
  Paper,
  Stack,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";

import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readPlan } from "@/lib/preview/readers";

export const dynamic = "force-dynamic";

export default function PlanPage() {
  const view = readPlan();

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          Before you build it
        </Title>
        <Text size="sm" c="dimmed">
          Growthmind read the branch. Here is what it thinks will happen, and what it would do
          instead.
        </Text>
      </Stack>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What you&apos;re about to ship
        </Text>
        <Text mt={4}>{view.aboutToShip}</Text>
      </Paper>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What we think it does to the people who actually arrive
        </Text>
        <Text mt={4}>{view.assessment}</Text>
        <Text size="sm" c="dimmed" mt="xs">
          {view.heldAgainst}
        </Text>
        <ButtonLink
          href="/audience"
          variant="subtle"
          size="compact-sm"
          mt="xs"
          style={tapTargetStyle}
        >
          The beliefs this rests on →
        </ButtonLink>
      </Paper>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          One change, ranked
        </Text>
        <TableScrollContainer minWidth={520}>
          <Table striped={false} withRowBorders>
            <TableThead>
              <TableTr>
                <TableTh>Change</TableTh>
                <TableTh ta="right">Impact</TableTh>
                <TableTh ta="right">Confidence</TableTh>
                <TableTh ta="right">Effort</TableTh>
                <TableTh ta="right">Score</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {view.ranked.map((row) => (
                <TableTr
                  key={row.change}
                  style={
                    row.picked ? { background: "var(--mantine-primary-color-light)" } : undefined
                  }
                >
                  <TableTd>
                    <Text fw={row.picked ? 700 : 400} size="sm">
                      {row.change}
                    </Text>
                  </TableTd>
                  <TableTd ta="right">{row.impact}</TableTd>
                  <TableTd ta="right" ff="monospace">
                    {row.confidence.toFixed(2)}
                  </TableTd>
                  <TableTd ta="right">{row.effort}</TableTd>
                  <TableTd ta="right" ff="monospace" fw={700}>
                    {row.score.toFixed(1)}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </TableScrollContainer>
        <Text size="sm" c="dimmed">
          {view.onlyOneReason}
        </Text>
      </Stack>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What we predict, before it runs
        </Text>
        <Text mt={4} mb="sm">
          {view.prediction}
        </Text>

        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          The tracking plan this needs — derived from the same flow
        </Text>
        <Box mt={4}>
          {view.trackingPlan.map((entry) => (
            <Group key={entry.event} gap="sm" wrap="nowrap">
              <Text ff="monospace" size="sm">
                {entry.event}
              </Text>
              {entry.note === null ? null : (
                <Text size="xs" c="dimmed">
                  ← {entry.note}
                </Text>
              )}
            </Group>
          ))}
        </Box>
        <Text size="sm" c="dimmed" mt="sm">
          {view.joinable}
        </Text>
      </Paper>
    </Stack>
  );
}
