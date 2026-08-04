import { Box, Code, Group, List, ListItem, SimpleGrid, Stack, Text } from "@mantine/core";

import { AgentTools } from "@/components/preview/AgentTools";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { PageHeader, RuledRow } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
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
      <PageHeader title="What your coding agent sees">
        The same findings, rendered for a machine. No second product, no translation layer —
        one artefact, two audiences.
      </PageHeader>

      <Stack gap={4}>
        <Eyebrow>How it attaches</Eyebrow>
        <Block>{view.config}</Block>
      </Stack>

      <Stack gap={4}>
        <Eyebrow>The three things it can ask for — all read-only</Eyebrow>
        <AgentTools tools={view.tools} />
      </Stack>

      <Stack gap={4}>
        <Eyebrow>One artefact, two audiences</Eyebrow>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <SurfaceCard>
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
          </SurfaceCard>
          <Box>
            <Text size="xs" c="dimmed" mb={6}>
              what the agent reads, over the wire
            </Text>
            <Block>{view.agentSees}</Block>
          </Box>
        </SimpleGrid>
      </Stack>

      <Stack gap={4}>
        <Eyebrow>When it sees it — only the first is something you do on purpose</Eyebrow>
        <Stack gap={0}>
          {view.moments.map((moment, index) => (
            <RuledRow
              key={moment.title}
              lead={
                <Text ff="monospace" size="xs" c="dimmed">
                  {String(index + 1).padStart(2, "0")}
                </Text>
              }
            >
              <Text fw={600} size="sm">
                {moment.title}
              </Text>
              <Text size="sm" c="dimmed">
                {moment.detail}
              </Text>
            </RuledRow>
          ))}
        </Stack>
      </Stack>

      <Stack gap={4}>
        <Eyebrow>What we put in your repository</Eyebrow>
        <SurfaceCard>
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
        </SurfaceCard>
        <Text size="sm" c="dimmed">
          {view.skillsNote}
        </Text>
      </Stack>

      <Stack gap={4}>
        <Eyebrow>What it cannot do — the boundary, on purpose</Eyebrow>
        <SurfaceCard>
          <List spacing="xs" size="sm">
            {view.cannot.map((line) => (
              <ListItem key={line}>{line}</ListItem>
            ))}
          </List>
        </SurfaceCard>
      </Stack>
    </Stack>
  );
}
