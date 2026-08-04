import { Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { notFound } from "next/navigation";

import { evidenceForAgent } from "@growthmind/shared";

import { AnnotatedTranscript } from "@/components/findings/AnnotatedTranscript";
import { DismissMenu } from "@/components/preview/DismissMenu";
import { CopyBlock } from "@/components/ui/CopyBlock";
import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { mintFixAction } from "@/lib/preview/actions";
import { pickSession, readEvidence } from "@/lib/preview/findings";
import { readPreviewState } from "@/lib/preview/session";
import { fixPath, seenPath } from "@/lib/preview/tabs";

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
  const hasFix = state.fixes.includes(record.id);

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          {record.headline}
        </Title>
        <Text size="sm" c="dimmed">
          {record.countLine}
          {record.withheld ? "" : " · one person's session below"}
        </Text>
      </Stack>

      {record.sessions.length <= 1 ? null : (
        <Group gap="xs">
          {record.sessions.map((entry) => (
            /* `Link` wraps the badge rather than being passed as `component`: this is a
               server component, and a function cannot cross into a client one as a prop. */
            <Link
              key={entry.id}
              href={`${seenPath(record.id)}?session=${entry.id}`}
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
        <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
          <Text fw={600}>We are not showing this recording</Text>
          <Text c="dimmed" mt={4}>
            We could not mask it confidently, so the detail stays sealed. The counts above were
            still measured from what happened.
          </Text>
        </Paper>
      ) : (
        <AnnotatedTranscript
          beats={session.beats}
          claims={session.claims}
          droppedClaims={session.droppedClaims}
        />
      )}

      {record.origin === null ? null : (
        <Paper
          withBorder
          radius="sm"
          p="md"
          bg="var(--mantine-color-default)"
          style={{ borderLeftWidth: 3, borderLeftColor: "var(--mantine-primary-color-filled)" }}
        >
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Where it came from
          </Text>
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
        </Paper>
      )}

      {record.cohortLine === null ? null : (
        <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
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
        </Paper>
      )}

      <Stack gap={4}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          Coverage and confidence
        </Text>
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

        {hasFix ? (
          <ButtonLink href={fixPath(record.id)} size="compact-sm" style={tapTargetStyle}>
            See the fix you asked for
          </ButtonLink>
        ) : (
          <form action={mintFixAction}>
            <input type="hidden" name="id" value={record.id} />
            <Button type="submit" size="compact-sm" style={tapTargetStyle}>
              Get it fixed
            </Button>
          </form>
        )}

        <DismissMenu id={record.id} />
      </Group>

      <Text size="sm">
        <Link href="/seen">← Back to everything we&apos;ve seen</Link>
      </Text>
    </Stack>
  );
}
