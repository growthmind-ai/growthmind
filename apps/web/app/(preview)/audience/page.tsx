import { Badge, Box, Group, Paper, Stack, Text, Title } from "@mantine/core";

import { readAudience } from "@/lib/preview/readers";
import type { BeliefSource } from "@/lib/preview/types";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Readonly<Record<BeliefSource, string>> = {
  observed: "observed",
  research: "research",
  assumed: "assumed",
};

function SourceChip({ source }: { readonly source: BeliefSource }) {
  return (
    <Badge
      variant={source === "assumed" ? "outline" : source === "observed" ? "light" : "default"}
      radius="sm"
      size="sm"
    >
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

export default function AudiencePage() {
  const view = readAudience();

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          Who we think this is for
        </Title>
        <Text size="sm" c="dimmed">
          Our model of your users, not a verdict on them. Every line says where it came from — and
          what it changed.
        </Text>
      </Stack>

      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Stack gap="xs">
          <Text>
            <Text span fw={700}>
              Built from:{" "}
            </Text>
            {view.builtFrom}
          </Text>
          <Text>
            <Text span fw={700}>
              How sure we are:{" "}
            </Text>
            {view.confidence}
          </Text>
          <Text>
            <Text span fw={700}>
              Last changed:{" "}
            </Text>
            {view.lastChanged}
          </Text>
        </Stack>
      </Paper>

      <Stack gap={2}>
        <Title order={2} size="h5">
          What we believe about them
        </Title>
        <Text size="sm" c="dimmed">
          Each belief carries its evidence and the decision it changed. A belief that changed
          nothing is a belief we should not be holding.
        </Text>
      </Stack>

      <Stack gap="sm">
        {view.beliefs.map((belief) => (
          <Paper key={belief.id} withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
            <Group gap="xs" align="center" mb={6} wrap="wrap">
              <Text fw={650}>{belief.claim}</Text>
              {belief.sources.map((source) => (
                <SourceChip key={source} source={source} />
              ))}
            </Group>
            <Text size="sm" c="dimmed" mb={8}>
              {belief.evidence}
            </Text>
            <Box pl="sm" style={{ borderLeft: "2px solid var(--mantine-primary-color-filled)" }}>
              <Text size="sm">
                <Text span fw={700}>
                  Changed:{" "}
                </Text>
                {belief.changed}
              </Text>
              {belief.settledBy === null ? null : (
                <Text size="sm" mt={2}>
                  <Text span fw={700}>
                    Would be settled by:{" "}
                  </Text>
                  {belief.settledBy}
                </Text>
              )}
            </Box>
          </Paper>
        ))}
      </Stack>

      <Stack gap={2}>
        <Title order={2} size="h5">
          What they arrive with
        </Title>
        <Text size="sm" c="dimmed">
          The constraints that decide whether a flow works, regardless of how well it is designed.
        </Text>
      </Stack>

      <Stack gap={0}>
        {view.arriveWith.map((fact) => (
          <Group
            key={fact.label}
            align="flex-start"
            wrap="nowrap"
            gap="md"
            py="xs"
            style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
          >
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ width: 170, flexShrink: 0 }}>
              {fact.label}
            </Text>
            <Text size="sm">{fact.value}</Text>
          </Group>
        ))}
      </Stack>

      <Title order={2} size="h5">
        What changed, and when
      </Title>
      <Stack gap="xs">
        <Paper
          withBorder
          radius="sm"
          p="md"
          bg="var(--mantine-color-default)"
          style={{ borderLeftWidth: 3, borderLeftColor: "var(--mantine-primary-color-filled)" }}
        >
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Until 2 August we believed
          </Text>
          <Text mt={4}>{view.wasBelieved}</Text>
        </Paper>
        <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            On 2 August we replaced it with
          </Text>
          <Text mt={4}>{view.nowBelieved}</Text>
        </Paper>
        <Paper withBorder radius="sm" p="md" bg="var(--mantine-primary-color-light)">
          <Text fw={650}>{view.consequence}</Text>
        </Paper>
      </Stack>

      <Title order={2} size="h5">
        What we are least sure about
      </Title>
      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Stack gap="sm">
          {view.leastSure.map((doubt) => (
            <Text key={doubt} size="sm">
              {doubt}
            </Text>
          ))}
        </Stack>
      </Paper>

      <Text
        size="sm"
        c="dimmed"
        pt="sm"
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      >
        We would rather show you a thin model you can argue with than a confident one you cannot
        check. If a belief here is wrong, say so — it changes what we rank next.
      </Text>
    </Stack>
  );
}
