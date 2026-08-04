import { Group, Stack, Text } from "@mantine/core";
import { notFound } from "next/navigation";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { ButtonLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readVerdictForFinding } from "@/lib/preview/readers";
import { fixPath } from "@/lib/preview/tabs";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function VerdictPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const verdict = readVerdictForFinding(id);
  if (verdict === null) notFound();

  return (
    <Stack gap="lg">
      <PageHeader title={verdict.title}>
        You cannot read the result on this page before you read the promise that judges it.
      </PageHeader>

      {/* Order is the argument. The criterion is above the measurement, both dated, so the
          gap between them is something the reader confirms rather than something we claim. */}
      <Stack gap="xs">
        <SurfaceCard tone="accent">
          <Eyebrow>{verdict.promisedOn}</Eyebrow>
          <Text mt={4}>{verdict.promise}</Text>
        </SurfaceCard>

        <SurfaceCard>
          <Eyebrow>{verdict.measuredOn}</Eyebrow>
          <Text mt={4}>{verdict.measurement}</Text>
        </SurfaceCard>

        <SurfaceCard tone="highlight">
          <Text fw={700}>{verdict.verdict}</Text>
        </SurfaceCard>
      </Stack>

      <SurfaceCard>
        <Eyebrow>What this does to our record</Eyebrow>
        <Text mt={4}>{verdict.record}</Text>
      </SurfaceCard>

      <Stack gap={4}>
        <Eyebrow>How this was measured, and what was set aside</Eyebrow>
        <Text size="sm" c="dimmed">
          {verdict.howMeasured}
        </Text>
      </Stack>

      <Group gap="md">
        <ButtonLink href={ROUTES.seen} variant="subtle" size="compact-sm" style={tapTargetStyle}>
          ← Back to everything we&apos;ve seen
        </ButtonLink>
        <ButtonLink href={fixPath(id)} variant="subtle" size="compact-sm" style={tapTargetStyle}>
          The fix behind it
        </ButtonLink>
      </Group>
    </Stack>
  );
}
