import {
  Box,
  Group,
  Stack,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { ButtonLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readPlan } from "@/lib/preview/readers";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default function PlanPage() {
  const view = readPlan();

  return (
    <Stack gap="lg">
      <PageHeader title="Before you build it">
        Growthmind read the branch. Here is what it thinks will happen, and what it would do
        instead.
      </PageHeader>

      <SurfaceCard>
        <Eyebrow>What you&apos;re about to ship</Eyebrow>
        <Text mt={4}>{view.aboutToShip}</Text>
      </SurfaceCard>

      <SurfaceCard>
        <Eyebrow>What we think it does to the people who actually arrive</Eyebrow>
        <Text mt={4}>{view.assessment}</Text>
        <Text size="sm" c="dimmed" mt="xs">
          {view.heldAgainst}
        </Text>
        <ButtonLink
          href={ROUTES.audience}
          variant="subtle"
          size="compact-sm"
          mt="xs"
          style={tapTargetStyle}
        >
          The beliefs this rests on →
        </ButtonLink>
      </SurfaceCard>

      <Stack gap={4}>
        <Eyebrow>One change, ranked</Eyebrow>
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

      <SurfaceCard>
        <Eyebrow>What we predict, before it runs</Eyebrow>
        <Text mt={4} mb="sm">
          {view.prediction}
        </Text>

        <Eyebrow>The tracking plan this needs — derived from the same flow</Eyebrow>
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
      </SurfaceCard>
    </Stack>
  );
}
