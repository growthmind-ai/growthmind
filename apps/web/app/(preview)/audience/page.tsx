import { Badge, Box, Group, Stack, Text } from "@mantine/core";

import { Eyebrow, LeadIn } from "@/components/ui/Eyebrow";
import { ClosingNote, PageHeader, RuledRow, SectionHeading } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
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
      <PageHeader title="Who we think this is for">
        Our model of your users, not a verdict on them. Every line says where it came from — and
        what it changed.
      </PageHeader>

      <SurfaceCard>
        <Stack gap="xs">
          <LeadIn label="Built from">{view.builtFrom}</LeadIn>
          <LeadIn label="How sure we are">{view.confidence}</LeadIn>
          <LeadIn label="Last changed">{view.lastChanged}</LeadIn>
        </Stack>
      </SurfaceCard>

      <SectionHeading title="What we believe about them">
        Each belief carries its evidence and the decision it changed. A belief that changed nothing
        is a belief we should not be holding.
      </SectionHeading>

      <Stack gap="sm">
        {view.beliefs.map((belief) => (
          <SurfaceCard key={belief.id}>
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
              <LeadIn label="Changed" size="sm">
                {belief.changed}
              </LeadIn>
              {belief.settledBy === null ? null : (
                <LeadIn label="Would be settled by" size="sm" mt={2}>
                  {belief.settledBy}
                </LeadIn>
              )}
            </Box>
          </SurfaceCard>
        ))}
      </Stack>

      <SectionHeading title="What they arrive with">
        The constraints that decide whether a flow works, regardless of how well it is designed.
      </SectionHeading>

      <Stack gap={0}>
        {view.arriveWith.map((fact) => (
          <RuledRow key={fact.label} lead={<Eyebrow>{fact.label}</Eyebrow>} leadWidth={170}>
            <Text size="sm">{fact.value}</Text>
          </RuledRow>
        ))}
      </Stack>

      <SectionHeading title="What changed, and when" />
      <Stack gap="xs">
        <SurfaceCard tone="accent">
          <Eyebrow>Until 2 August we believed</Eyebrow>
          <Text mt={4}>{view.wasBelieved}</Text>
        </SurfaceCard>
        <SurfaceCard>
          <Eyebrow>On 2 August we replaced it with</Eyebrow>
          <Text mt={4}>{view.nowBelieved}</Text>
        </SurfaceCard>
        <SurfaceCard tone="highlight">
          <Text fw={650}>{view.consequence}</Text>
        </SurfaceCard>
      </Stack>

      <SectionHeading title="What we are least sure about" />
      <SurfaceCard>
        <Stack gap="sm">
          {view.leastSure.map((doubt) => (
            <Text key={doubt} size="sm">
              {doubt}
            </Text>
          ))}
        </Stack>
      </SurfaceCard>

      <ClosingNote>
        We would rather show you a thin model you can argue with than a confident one you cannot
        check. If a belief here is wrong, say so — it changes what we rank next.
      </ClosingNote>
    </Stack>
  );
}
