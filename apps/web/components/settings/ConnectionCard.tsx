import { Badge, Box, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import type { ConnectionCardView, ConnectionTone } from "@growthmind/shared";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

const TONE_COLORS: Record<ConnectionTone, string> = {
  live: "band",
  waiting: "gray",
  attention: "stamp",
  off: "gray",
};

// A working connection is filled and a stopped one is outlined, so the two grey states
// are told apart without reading the word — colour alone would not separate them, and
// one of them is the state that needs a person.
const TONE_VARIANTS: Record<ConnectionTone, string> = {
  live: "light",
  waiting: "light",
  attention: "light",
  off: "outline",
};

function StatusBadge({ tone, label }: { tone: ConnectionTone; label: string }) {
  return (
    <Badge color={TONE_COLORS[tone]} variant={TONE_VARIANTS[tone]} tt="none" radius="sm">
      {label}
    </Badge>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" gap="md" wrap="nowrap" align="baseline">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" ta="right" style={{ overflowWrap: "anywhere" }}>
        {value}
      </Text>
    </Group>
  );
}

interface ConnectionCardProps {
  readonly view: ConnectionCardView;

  // The controls that change this connection. Rendered under the facts because what a
  // control does is only readable once the thing it acts on has been named.
  readonly children?: ReactNode;
}

export function ConnectionCard({ view, children }: ConnectionCardProps) {
  return (
    <SurfaceCard tone={view.tone === "attention" ? "accent" : "default"}>
      <Stack gap="sm">
        <Stack gap={4}>
          <Group justify="space-between" gap="sm" align="flex-start" wrap="nowrap">
            <Eyebrow>{view.title}</Eyebrow>
            <StatusBadge tone={view.tone} label={view.statusLabel} />
          </Group>

          <Title order={2} size="h4" style={{ overflowWrap: "anywhere" }}>
            {view.headline}
          </Title>
        </Stack>

        <Text size="sm" c="dimmed">
          {view.statement}
        </Text>

        {view.facts.length === 0 ? null : (
          <Box>
            <Stack gap={6}>
              {view.facts.map((fact) => (
                <FactRow key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </Stack>
          </Box>
        )}

        {children}
      </Stack>
    </SurfaceCard>
  );
}
