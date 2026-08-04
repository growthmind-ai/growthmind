import { Group, Paper, Stack, Text, Title } from "@mantine/core";

import { CopyBlock } from "@/components/ui/CopyBlock";
import { readCollect } from "@/lib/preview/readers";

export const dynamic = "force-dynamic";

export default function CollectPage() {
  const view = readCollect();

  const asText = view.groups
    .flatMap((group) => [
      `${group.label.toUpperCase()}  (${group.version})`,
      ...group.statements.map((statement) => `- ${statement}`),
      "",
    ])
    .concat(view.closing)
    .join("\n");

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          What we do and do not collect
        </Title>
        <Text size="sm" c="dimmed">
          Not written by hand. If the rules change, this page changes with them — or a test fails.
        </Text>
      </Stack>

      <Stack gap="sm">
        {view.groups.map((group) => (
          <Paper key={group.label} withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
            <Group justify="space-between" gap="md" wrap="wrap" mb={6}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {group.label}
              </Text>
              <Text size="xs" ff="monospace" c="dimmed">
                {group.version}
              </Text>
            </Group>
            <Stack gap={4}>
              {group.statements.map((statement) => (
                <Text key={statement} size="sm">
                  {statement}
                </Text>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Group>
        <CopyBlock value={asText} label="Copy as text" />
      </Group>

      <Text size="sm" c="dimmed">
        {view.closing}
      </Text>
    </Stack>
  );
}
