"use client";

import { Button, Code, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { tapTargetStyle } from "@/components/ui/tap-target";
import type { AgentTool } from "@/lib/preview/types";

export function AgentTools({ tools }: { readonly tools: readonly AgentTool[] }) {
  const [selected, setSelected] = useState(tools[0]?.key ?? "");
  const active = tools.find((tool) => tool.key === selected) ?? tools[0];

  if (active === undefined) return null;

  return (
    <Stack gap="xs">
      <Group gap="xs">
        {tools.map((tool) => (
          <Button
            key={tool.key}
            variant={tool.key === active.key ? "light" : "default"}
            size="compact-sm"
            ff="monospace"
            style={tapTargetStyle}
            onClick={() => setSelected(tool.key)}
          >
            {tool.name}
          </Button>
        ))}
      </Group>

      <Text size="sm" c="dimmed">
        {active.why}
      </Text>

      <Group justify="space-between" gap="md">
        <Text ff="monospace" size="xs" c="dimmed">
          {active.call}
        </Text>
        <Eyebrow>read-only</Eyebrow>
      </Group>

      <Code block style={{ fontSize: "0.75rem", lineHeight: 1.7 }}>
        {active.response}
      </Code>
    </Stack>
  );
}
