import { Box, Group, Paper, Stack, Text } from "@mantine/core";

import { FindingActions } from "@/components/preview/FindingActions";
import { ButtonLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { readChannel } from "@/lib/preview/readers";
import { readPreviewState } from "@/lib/preview/session";
import { findingPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

export default async function ChannelPage() {
  const view = readChannel();
  const state = await readPreviewState();

  return (
    <Stack gap="lg">
      <PageHeader title="Findings arrive where you already are">
        Fully legible without clicking anything. The link is for checking us, not for understanding
        us.
      </PageHeader>

      <Paper withBorder radius="md" style={{ overflow: "hidden", maxWidth: 760 }}>
        <Box
          px="md"
          py="xs"
          style={{
            background: "var(--mantine-color-default)",
            borderBottom: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <Text size="sm" fw={600} c="dimmed">
            #{view.channel}
          </Text>
        </Box>

        {view.messages.map((message, index) => (
          <Box
            key={message.id}
            p="md"
            style={{
              borderTop: index === 0 ? undefined : "1px solid var(--mantine-color-default-border)",
            }}
          >
            <Group gap="xs" mb={6}>
              <Text fw={700} size="sm">
                Growthmind
              </Text>
              <Text size="xs" c="dimmed">
                {message.at}
              </Text>
            </Group>

            {message.lead === null ? null : (
              <Text fw={650} mb={6}>
                {message.lead}
              </Text>
            )}

            {message.body.map((paragraph) => (
              <Text key={paragraph} mb={6}>
                {paragraph}
              </Text>
            ))}

            {message.evidence === null ? null : (
              <Text
                size="sm"
                c="dimmed"
                mb={6}
                pl="sm"
                style={{ borderLeft: "2px solid var(--mantine-primary-color-filled)" }}
              >
                {message.evidence}
              </Text>
            )}

            {message.forecast === null ? null : <Text mb="sm">{message.forecast}</Text>}

            {message.findingId === null ? null : (
              <Group gap="xs" align="flex-start">
                <FindingActions
                  id={message.findingId}
                  hasFix={state.fixes.includes(message.findingId)}
                />
                <ButtonLink
                  href={findingPath(message.findingId)}
                  variant="subtle"
                  size="compact-sm"
                  style={tapTargetStyle}
                >
                  See the evidence →
                </ButtonLink>
              </Group>
            )}
          </Box>
        ))}
      </Paper>

      <Text size="sm" c="dimmed">
        One thing at a time, with a hard ceiling per week. A day with nothing to say says nothing —
        and says so.
      </Text>
    </Stack>
  );
}
