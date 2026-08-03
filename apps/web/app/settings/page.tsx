import { Container, Stack, Text, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import {
  SETTINGS_BACK_LABEL,
  SETTINGS_CHANNEL_FIXED_LINE,
  SETTINGS_NO_DELIVERY_LINE,
  SETTINGS_POSTING_TEMPLATE,
  SETTINGS_SETTLED_LINE,
  SETTINGS_TITLE,
  SLACK_CONNECTION_FIELDS,
} from "@growthmind/shared";

import { SlackConnection } from "@/components/slack/SlackConnection";
import { AnchorLink } from "@/components/ui/Links";
import { getDb } from "@/lib/db";
import { ROUTES } from "@/lib/routes";
import { readSlackSettings } from "@/lib/settings/slack";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    redirect(ROUTES.signIn);
  }

  const slack = await readSlackSettings(getDb(), ctx);
  const connected = slack.channelId !== null;

  return (
    <Container size="sm" py="xl" px="md">
      <Stack gap="md">
        <Title order={1} size="h3">
          {SETTINGS_TITLE}
        </Title>

        {/* The state first, then the control that changes it. A founder who
            skipped setup's Slack step is told on three other screens to connect
            one; this is the page those sentences mean (B-035). */}
        {slack.channelId === null ? (
          <Text c="dimmed">{SETTINGS_NO_DELIVERY_LINE}</Text>
        ) : (
          <>
            <Text>{SETTINGS_POSTING_TEMPLATE.replaceAll("{channel}", slack.channelId)}</Text>

            {/* The success moment says what became true and that nothing more is
                owed, then names the one thing this page cannot undo. Without
                both, a founder who has just finished reads a confirmation and a
                Back link, and a founder who picked the wrong channel finds an
                absent control with no explanation (D12). */}
            <Text c="dimmed">{SETTINGS_SETTLED_LINE}</Text>
            <Text size="sm" c="dimmed">
              {SETTINGS_CHANNEL_FIXED_LINE}
            </Text>
          </>
        )}

        {/* `settled` is whether there is anywhere to deliver, never whether setup
            was finished: skipping Slack settles a STEP, and leaves this page with
            its whole reason to exist. Nothing here is skippable — this card is
            the page. */}
        <SlackConnection
          fields={SLACK_CONNECTION_FIELDS}
          settled={connected}
          interactive
          skippable={false}
          skipped={false}
          channelId={slack.channelId}
          slackWorkspaceAttached={slack.workspaceAttached}
          slackWorkspaceName={slack.workspaceName}
          slackOAuthAvailable={slack.oauthAvailable}
        />

        <AnchorLink href={ROUTES.home} size="sm">
          {SETTINGS_BACK_LABEL}
        </AnchorLink>
      </Stack>
    </Container>
  );
}
