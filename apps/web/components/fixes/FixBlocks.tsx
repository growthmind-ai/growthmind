"use client";

import { Accordion, Group, Stack, Text } from "@mantine/core";

export interface FixBlock {
  readonly value: string;
  readonly heading: string;
  readonly sentences: readonly string[];
}

// Sections of one document, so they open independently — a reader comparing what was
// measured against what this does not say needs both at once.
export function FixBlocks({ blocks }: { readonly blocks: readonly FixBlock[] }) {
  return (
    <Accordion multiple variant="separated" radius="sm" chevronPosition="right">
      {blocks.map((block) => (
        <Accordion.Item key={block.value} value={block.value}>
          <Accordion.Control>
            <Group justify="space-between" wrap="nowrap" gap="md">
              <Text fw={600} size="sm">
                {block.heading}
              </Text>
              <Text ff="monospace" size="xs" c="dimmed">
                {block.sentences.length}
              </Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {block.sentences.map((sentence) => (
                <Text key={sentence} size="sm" c="dimmed">
                  {sentence}
                </Text>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
