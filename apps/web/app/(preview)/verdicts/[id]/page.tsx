import { Group, Paper, Stack, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readVerdictForFinding } from "@/lib/preview/readers";
import { ROUTES } from "@/lib/routes";
import { fixPath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

export default async function VerdictPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const verdict = readVerdictForFinding(id);
  if (verdict === null) notFound();

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          {verdict.title}
        </Title>
        <Text size="sm" c="dimmed">
          You cannot read the result on this page before you read the promise that judges it.
        </Text>
      </Stack>

      {/* Order is the argument. The criterion is above the measurement, both dated, so the
          gap between them is something the reader confirms rather than something we claim. */}
      <Stack gap="xs">
        <Paper
          withBorder
          radius="sm"
          p="md"
          bg="var(--mantine-color-default)"
          style={{ borderLeftWidth: 3, borderLeftColor: "var(--mantine-primary-color-filled)" }}
        >
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            {verdict.promisedOn}
          </Text>
          <Text mt={4}>{verdict.promise}</Text>
        </Paper>

        <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            {verdict.measuredOn}
          </Text>
          <Text mt={4}>{verdict.measurement}</Text>
        </Paper>

        <Paper withBorder radius="sm" p="md" bg="var(--mantine-primary-color-light)">
          <Text fw={700}>{verdict.verdict}</Text>
        </Paper>
      </Stack>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What this does to our record
        </Text>
        <Text mt={4}>{verdict.record}</Text>
      </Paper>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          How this was measured, and what was set aside
        </Text>
        <Text size="sm" c="dimmed">
          {verdict.howMeasured}
        </Text>
      </Stack>

      <Group gap="md">
        <ButtonLink href={ROUTES.seen} variant="subtle" size="compact-sm" style={tapTargetStyle}>
          ← Back to everything we&apos;ve seen
        </ButtonLink>
        <ButtonLink href={fixPath(id)} variant="subtle" size="compact-sm" style={tapTargetStyle}>
          The fix behind it
        </ButtonLink>
      </Group>
    </Stack>
  );
}
