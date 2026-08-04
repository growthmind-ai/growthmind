import { Badge, Box, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";

import { AnchorLink, ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readOutVerdictAction } from "@/lib/preview/actions";
import { readFixForFinding, readVerdictForFinding } from "@/lib/preview/readers";
import { readPreviewState } from "@/lib/preview/session";
import { evidencePath, verdictPath } from "@/lib/preview/tabs";
import { ROUTES } from "@/lib/routes";
import type { CheckState } from "@/lib/preview/types";

export const dynamic = "force-dynamic";

const MARK: Readonly<Record<CheckState, string>> = {
  confirmed: "✓",
  measuring: "·",
  missing: "!",
};

export default async function FixPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  const fix = readFixForFinding(id);
  if (fix === null) notFound();

  const state = await readPreviewState();
  const verdict = readVerdictForFinding(id);
  const readOut = state.readOut.includes(id);

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          {fix.title}
        </Title>
        <Text size="sm" c="dimmed">
          Sent to{" "}
          <AnchorLink href={ROUTES.agent} size="sm">
            {fix.dispatchedTo}
          </AnchorLink>{" "}
          on {fix.dispatchedOn} · reads out {fix.readoutDue}
        </Text>
      </Stack>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What changes
        </Text>
        <Text mt={4}>{fix.whatChanges}</Text>
        <Text ff="monospace" size="sm" c="dimmed" mt={4}>
          {fix.where}
        </Text>
      </Paper>

      <Paper
        withBorder
        radius="sm"
        p="md"
        bg="var(--mantine-color-default)"
        style={{ borderLeftWidth: 3, borderLeftColor: "var(--mantine-primary-color-filled)" }}
      >
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          Introduced by · fixed by
        </Text>
        <Text mt={4}>{fix.prNote}</Text>
        <Group gap="xs" mt="xs">
          <Badge variant="default" radius="sm" ff="monospace">
            PR #{fix.introducedByPr}
          </Badge>
          <Badge variant="light" radius="sm" ff="monospace">
            PR #{fix.fixedByPr}
          </Badge>
        </Group>
      </Paper>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          Checks that decide whether it worked
        </Text>
        <Stack gap={6}>
          {fix.checks.map((check) => (
            <Paper
              key={check.text}
              withBorder
              radius="sm"
              p="xs"
              bg="var(--mantine-color-default)"
              style={
                check.state === "confirmed"
                  ? { borderColor: "var(--mantine-primary-color-filled)" }
                  : undefined
              }
            >
              <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Text ff="monospace" fw={700} c={check.state === "confirmed" ? "bright" : "dimmed"}>
                    {MARK[check.state]}
                  </Text>
                  <Text size="sm">{check.text}</Text>
                </Group>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {check.stamp}
                </Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Stack>

      <Text size="sm" c="dimmed">
        {fix.trustNote}
      </Text>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          The stop rule, exactly as set on {fix.dispatchedOn}
        </Text>
        <Text size="sm" mt={4}>
          {fix.stopRule}
        </Text>
      </Paper>

      <Box>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>
          Everything that happened, in order
        </Text>
        {fix.log.map((line) => (
          <Text key={line} ff="monospace" size="xs" c="dimmed">
            {line}
          </Text>
        ))}
      </Box>

      <Group gap="md">
        {verdict === null ? null : readOut ? (
          <ButtonLink href={verdictPath(id)} size="compact-sm" style={tapTargetStyle}>
            See the verdict →
          </ButtonLink>
        ) : (
          <form action={readOutVerdictAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" size="compact-sm" style={tapTargetStyle}>
              Read out the result
            </Button>
          </form>
        )}
        <ButtonLink
          href={evidencePath(id)}
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
