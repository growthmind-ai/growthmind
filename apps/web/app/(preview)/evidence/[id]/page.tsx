import { Badge, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";
import { notFound } from "next/navigation";

import { evidenceForAgent } from "@growthmind/shared";

import { AnnotatedTranscript } from "@/components/findings/AnnotatedTranscript";
import { FindingActions } from "@/components/preview/FindingActions";
import { CopyBlock } from "@/components/ui/CopyBlock";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { PageHeader } from "@/components/ui/Page";
import { pickSession, readEvidence } from "@/lib/preview/findings";
import { readPreviewState } from "@/lib/preview/session";
import { evidencePath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EvidencePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const record = readEvidence(id);
  if (record === null) notFound();

  const requested = (await searchParams).session;
  const session = pickSession(record, typeof requested === "string" ? requested : undefined);
  const state = await readPreviewState();

  return (
    <Stack gap="lg">
      <PageHeader title={record.headline}>
        {record.countLine}
        {record.withheld ? "" : " · one person's session below"}
      </PageHeader>

      {record.sessions.length <= 1 ? null : (
        <Group gap="xs">
          {record.sessions.map((entry) => (
            /* `Link` wraps the badge rather than being passed as `component`: this is a
               server component, and a function cannot cross into a client one as a prop. */
            <Link
              key={entry.id}
              href={`${evidencePath(record.id)}?session=${entry.id}`}
              style={{ textDecoration: "none" }}
            >
              <Badge
                variant={entry.id === session?.id ? "filled" : "default"}
                radius="sm"
                style={{ cursor: "pointer" }}
              >
                {entry.label}
              </Badge>
            </Link>
          ))}
        </Group>
      )}

      {/* Below the mask floor there is no transcript at all, and the page says so rather
          than rendering an empty one. */}
      {record.withheld || session === null ? (
        <SurfaceCard>
          <Text fw={600}>We are not showing this recording</Text>
          <Text c="dimmed" mt={4}>
            We could not mask it confidently, so the detail stays sealed. The counts above were
            still measured from what happened.
          </Text>
        </SurfaceCard>
      ) : (
        <AnnotatedTranscript
          beats={session.beats}
          claims={session.claims}
          droppedClaims={session.droppedClaims}
        />
      )}

      {record.origin === null ? null : (
        <SurfaceCard tone="accent">
          <Eyebrow>Where it came from</Eyebrow>
          <Text ff="monospace" fw={700} mt={4}>
            PR #{record.origin.pullRequest}
          </Text>
          <Text>{record.origin.title}</Text>
          <Text ff="monospace" size="xs" c="dimmed" mt={2}>
            {record.origin.meta}
          </Text>
          <Text size="sm" mt="xs">
            {record.origin.why}
          </Text>
        </SurfaceCard>
      )}

      {record.cohortLine === null ? null : (
        <SurfaceCard>
          <Text fw={600}>{record.cohortLine}</Text>
          {record.cohortNote === null ? null : (
            <Text size="sm" c="dimmed" mt={4}>
              {record.cohortNote}
            </Text>
          )}
          {record.cohortBeats.length === 0 ? null : (
            <Stack gap={0} mt="sm">
              {record.cohortBeats.map((beat) => (
                <Group key={beat.index} gap="sm" wrap="nowrap" align="flex-start">
                  <Text ff="monospace" size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {beat.at}
                  </Text>
                  <Text ff="monospace" size="xs" c={beat.notable ? "bright" : "dimmed"}>
                    {beat.text}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </SurfaceCard>
      )}

      <Stack gap={4}>
        <Eyebrow>Coverage and confidence</Eyebrow>
        <Text size="sm" c="dimmed">
          {record.coverageLine}
        </Text>
      </Stack>

      <Group gap="md" align="flex-start">
        {session === null ? null : (
          <CopyBlock
            value={evidenceForAgent({
              id: record.id,
              headline: record.headline,
              countLine: record.countLine,
              beats: session.beats,
              claims: session.claims,
              droppedClaims: session.droppedClaims,
              cohortLine: record.cohortLine,
              sessions: [],
              currentSessionId: session.id,
              coverageLine: record.coverageLine,
              withheld: record.withheld,
            })}
            label="Copy this for your coding agent"
          />
        )}

        <FindingActions id={record.id} hasFix={state.fixes.includes(record.id)} />
      </Group>

      <Text size="sm">
        <Link href="/seen">← Back to everything we&apos;ve seen</Link>
      </Text>
    </Stack>
  );
}
