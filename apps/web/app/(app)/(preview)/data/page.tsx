import { Group, Stack, Text } from "@mantine/core";

import { CopyBlock } from "@/components/ui/CopyBlock";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
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
      <PageHeader title="What we do and do not collect">
        Not written by hand. If the rules change, this page changes with them — or a test fails.
      </PageHeader>

      <Stack gap="sm">
        {view.groups.map((group) => (
          <SurfaceCard key={group.label}>
            <Group justify="space-between" gap="md" wrap="wrap" mb={6}>
              <Eyebrow>{group.label}</Eyebrow>
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
          </SurfaceCard>
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
