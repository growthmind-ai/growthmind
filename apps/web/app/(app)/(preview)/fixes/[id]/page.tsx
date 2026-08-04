import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import { notFound } from "next/navigation";

import { VerdictButton } from "@/components/preview/FindingActions";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { AnchorLink, ButtonLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readFixForFinding, readVerdictForFinding } from "@/lib/preview/readers";
import { readPreviewState } from "@/lib/preview/session";
import { findingPath } from "@/lib/paths";
import { ROUTES } from "@/lib/routes";
import type { CheckState } from "@/lib/preview/types";

export const dynamic = "force-dynamic";

const MARK: Readonly<Record<CheckState, string>> = {
  confirmed: "✓",
  measuring: "·",
  missing: "!",
};

export default async function FixPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const fix = readFixForFinding(id);
  if (fix === null) notFound();

  const state = await readPreviewState();
  const verdict = readVerdictForFinding(id);

  return (
    <Stack gap="lg">
      <PageHeader title={fix.title}>
        Sent to{" "}
        <AnchorLink href={ROUTES.agent} size="sm">
          {fix.dispatchedTo}
        </AnchorLink>{" "}
        on {fix.dispatchedOn} · reads out {fix.readoutDue}
      </PageHeader>

      <SurfaceCard>
        <Eyebrow>What changes</Eyebrow>
        <Text mt={4}>{fix.whatChanges}</Text>
        <Text ff="monospace" size="sm" c="dimmed" mt={4}>
          {fix.where}
        </Text>
      </SurfaceCard>

      <SurfaceCard tone="accent">
        <Eyebrow>Introduced by · fixed by</Eyebrow>
        <Text mt={4}>{fix.prNote}</Text>
        <Group gap="xs" mt="xs">
          <Badge variant="default" radius="sm" ff="monospace">
            PR #{fix.introducedByPr}
          </Badge>
          <Badge variant="light" radius="sm" ff="monospace">
            PR #{fix.fixedByPr}
          </Badge>
        </Group>
      </SurfaceCard>

      <Stack gap={4}>
        <Eyebrow>Checks that decide whether it worked</Eyebrow>
        <Stack gap={6}>
          {fix.checks.map((check) => (
            <SurfaceCard
              key={check.text}
              p="xs"
              style={
                check.state === "confirmed"
                  ? { borderColor: "var(--mantine-primary-color-filled)" }
                  : undefined
              }
            >
              <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Text
                    ff="monospace"
                    fw={700}
                    c={check.state === "confirmed" ? "bright" : "dimmed"}
                  >
                    {MARK[check.state]}
                  </Text>
                  <Text size="sm">{check.text}</Text>
                </Group>
                <Eyebrow style={{ whiteSpace: "nowrap" }}>{check.stamp}</Eyebrow>
              </Group>
            </SurfaceCard>
          ))}
        </Stack>
      </Stack>

      <Text size="sm" c="dimmed">
        {fix.trustNote}
      </Text>

      <SurfaceCard>
        <Eyebrow>The stop rule, exactly as set on {fix.dispatchedOn}</Eyebrow>
        <Text size="sm" mt={4}>
          {fix.stopRule}
        </Text>
      </SurfaceCard>

      <Box>
        <Eyebrow mb={4}>Everything that happened, in order</Eyebrow>
        {fix.log.map((line) => (
          <Text key={line} ff="monospace" size="xs" c="dimmed">
            {line}
          </Text>
        ))}
      </Box>

      <Group gap="md">
        {verdict === null ? null : <VerdictButton id={id} readOut={state.readOut.includes(id)} />}
        <ButtonLink
          href={findingPath(id)}
          variant="subtle"
          size="compact-sm"
          style={tapTargetStyle}
        >
          ← The evidence behind it
        </ButtonLink>
      </Group>
    </Stack>
  );
}
