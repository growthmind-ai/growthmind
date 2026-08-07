import { Group, Stack, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/fixes/EmptyState";
import { FixBlocks } from "@/components/fixes/FixBlocks";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ButtonLink } from "@/components/ui/Links";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { getDb } from "@/lib/db";
import { readFixDetail } from "@/lib/fixes/read";
import {
  DETAIL_UNAVAILABLE_BODY,
  DETAIL_UNAVAILABLE_HEADING,
  EVIDENCE_ACTION,
  HELD_BODY,
  HELD_HEADING,
  SAME_DOCUMENT_NOTE,
} from "@/lib/fixes/view";
import { findingPath } from "@/lib/paths";
import { ROUTES } from "@/lib/routes";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function BackToList() {
  return (
    <Group>
      <ButtonLink href={ROUTES.fixes} variant="subtle" size="compact-sm" style={tapTargetStyle}>
        ← Open fixes
      </ButtonLink>
    </Group>
  );
}

export default async function FixPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext();

  const view = await readFixDetail(getDb(), ctx, id, new Date());

  if (view.kind === "missing") notFound();

  // Deliberately not a 404. A fix we could not fetch still exists, and telling someone who
  // followed a Slack link that it does not is the failure this page exists to avoid.
  if (view.kind === "unavailable") {
    return (
      <Stack gap="lg">
        <BackToList />
        <EmptyState heading={DETAIL_UNAVAILABLE_HEADING}>{DETAIL_UNAVAILABLE_BODY}</EmptyState>
      </Stack>
    );
  }

  // Not a 404: we hold this fix and cannot put it into words. The list is right to hide it,
  // which is exactly why a Slack link to it must not be told it does not exist.
  if (view.kind === "held") {
    return (
      <Stack gap="lg">
        <BackToList />
        <EmptyState
          heading={HELD_HEADING}
          href={findingPath(view.findingId)}
          action={EVIDENCE_ACTION}
        >
          {HELD_BODY}
        </EmptyState>
      </Stack>
    );
  }

  const { spec, promise } = view;

  return (
    <Stack gap="lg">
      <BackToList />

      <Stack gap={4}>
        <Text ff="monospace" size="sm" c="dimmed">
          {spec.surface}
        </Text>
        <Title order={1} size="h3">
          {spec.symptom}
        </Title>
      </Stack>

      <SurfaceCard tone={promise.late ? "accent" : "default"}>
        <Eyebrow>The date</Eyebrow>
        <Text fw={600} mt={4} c={promise.late ? "stamp.4" : "bright"}>
          {promise.lead}
        </Text>
        <Text size="sm" c="dimmed">
          {promise.aside}
        </Text>
      </SurfaceCard>

      <FixBlocks
        blocks={[
          {
            value: "measured",
            heading: "What was measured",
            sentences: [...spec.measurement, ...view.setAside],
          },
          { value: "seen", heading: "What was seen", sentences: spec.evidence },
          { value: "unsaid", heading: "What this does not say", sentences: spec.boundary },
        ]}
      />

      <Group justify="space-between" align="flex-end" gap="md">
        <Text size="sm" c="dimmed" style={{ flex: 1, minWidth: 260 }}>
          {SAME_DOCUMENT_NOTE}
        </Text>
        <ButtonLink
          href={findingPath(view.findingId)}
          variant="default"
          size="compact-sm"
          style={tapTargetStyle}
        >
          {EVIDENCE_ACTION}
        </ButtonLink>
      </Group>
    </Stack>
  );
}
