import { Stack, Text } from "@mantine/core";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ensureProject } from "@growthmind/db";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { getDb } from "@/lib/db";
import { readLiveFinding } from "@/lib/findings/read";
import { getTenantContext } from "@/lib/tenant";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function FindingPage({ params }: PageProps) {
  const { id } = await params;

  const ctx = await getTenantContext();
  if (ctx === null) notFound();

  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);
  const finding = await readLiveFinding(db, ctx, projectId, id);
  if (finding === null) notFound();

  return (
    <Stack gap="lg">
      <PageHeader title={finding.headline}>{finding.countLine}</PageHeader>

      {finding.withheld ? (
        <SurfaceCard>
          <Text fw={600}>We are not showing this recording</Text>
          <Text c="dimmed" mt={4}>
            We could not mask it confidently, so the detail stays sealed. The counts above were
            still measured from what happened.
          </Text>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <Stack gap="xs">
            <Eyebrow>What happened</Eyebrow>
            <Text>{finding.context}</Text>
            <Text size="sm" c="dimmed">
              We can&apos;t yet say why — that stage isn&apos;t built.
            </Text>
          </Stack>
        </SurfaceCard>
      )}

      <Stack gap={4}>
        <Eyebrow>Coverage and confidence</Eyebrow>
        <Text size="sm" c="dimmed">
          {finding.coverageLine}
        </Text>
      </Stack>

      <Text size="sm">
        <Link href={ROUTES.findings}>← All findings</Link>
      </Text>
    </Stack>
  );
}
