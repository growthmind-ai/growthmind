import { Box, Code, Group, List, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";

import { AgentTools } from "@/components/preview/AgentTools";
import { readAgent } from "@/lib/preview/readers";

export const dynamic = "force-dynamic";

function Block({ children }: { readonly children: string }) {
  return (
    <Code block style={{ fontSize: "0.78rem", lineHeight: 1.7 }}>
      {children}
    </Code>
  );
}

export default function AgentPage() {
  const view = readAgent();

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          What your coding agent sees
        </Title>
        <Text size="sm" c="dimmed">
          The same findings, rendered for a machine. No second product, no translation layer —
          one artefact, two audiences.
        </Text>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          How it attaches
        </Text>
        <Block>{view.config}</Block>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          The three things it can ask for — all read-only
        </Text>
        <AgentTools tools={view.tools} />
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          One artefact, two audiences
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
            <Text size="xs" c="dimmed" mb={6}>
              what the founder reads, in Slack
            </Text>
            {view.founderSees.map((line, index) => (
              <Text
                key={line}
                fw={index === 0 ? 650 : 400}
                size={index === view.founderSees.length - 1 ? "sm" : "md"}
                c={index === view.founderSees.length - 1 ? "dimmed" : "bright"}
                mb={4}
              >
                {line}
              </Text>
            ))}
          </Paper>
          <Box>
            <Text size="xs" c="dimmed" mb={6}>
              what the agent reads, over the wire
            </Text>
            <Block>{view.agentSees}</Block>
          </Box>
        </SimpleGrid>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          When it sees it — only the first is something you do on purpose
        </Text>
        <Stack gap={0}>
          {view.moments.map((moment, index) => (
            <Group
              key={moment.title}
              align="flex-start"
              wrap="nowrap"
              gap="md"
              py="xs"
              style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
            >
              <Text ff="monospace" size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {String(index + 1).padStart(2, "0")}
              </Text>
              <Box>
                <Text fw={600} size="sm">
                  {moment.title}
                </Text>
                <Text size="sm" c="dimmed">
                  {moment.detail}
                </Text>
              </Box>
            </Group>
          ))}
        </Stack>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What we put in your repository
        </Text>
        <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
          <Stack gap={4}>
            {view.skills.map((skill) => (
              <Group key={skill.name} gap="sm" wrap="nowrap" align="flex-start">
                <Text ff="monospace" size="sm" fw={700} style={{ flexShrink: 0 }}>
                  {skill.name}
                </Text>
                <Text size="sm" c="dimmed">
                  {skill.does}
                </Text>
              </Group>
            ))}
          </Stack>
        </Paper>
        <Text size="sm" c="dimmed">
          {view.skillsNote}
        </Text>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          What it cannot do — the boundary, on purpose
        </Text>
        <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
          <List spacing="xs" size="sm">
            {view.cannot.map((line) => (
              <List.Item key={line}>{line}</List.Item>
            ))}
          </List>
        </Paper>
      </Stack>
    </Stack>
  );
}
