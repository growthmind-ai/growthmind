import { Container, Divider, Stack, Text, Title } from "@mantine/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ensureProject } from "@growthmind/db";
import {
  ANALYTICS_STEP,
  isAnalyticsAttached,
  ONBOARDING_MESSAGES,
  SETTINGS_TITLE,
  SLACK_CONNECTION_FIELDS,
  type StepView,
} from "@growthmind/shared";

import { ConnectAnalyticsForm } from "@/components/first-run/ConnectAnalyticsForm";
import { PrivacyReceipt } from "@/components/first-run/PrivacyReceipt";
import { SlackConnection } from "@/components/slack/SlackConnection";
import { SlackDeliveryControls } from "@/components/slack/SlackDeliveryControls";
import { AnchorLink } from "@/components/ui/Links";
import { getDb } from "@/lib/db";
import { ROUTES } from "@/lib/routes";
import { readSettingsView, type SettingsView } from "@/lib/settings/view";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

// Mounted outside any step sequence, so the sequence's reducer is not consulted: on this
// page the form is never pending on an earlier step and is always the founder's to use.
function analyticsView(attached: boolean): StepView {
  return {
    id: "analytics",
    ordinal: ANALYTICS_STEP.ordinal,
    state: attached ? "done" : "active",
    open: true,
    interactive: true,
  };
}

function Source({ view }: { view: SettingsView }) {
  const attached = isAnalyticsAttached(view.source.status);

  return (
    <Section title={ONBOARDING_MESSAGES.settingsSourceGroup}>
      {attached && view.source.host !== null && view.source.sourceProjectId !== null ? (
        <Text>
          {ONBOARDING_MESSAGES.settingsSourceConnectedTemplate
            .replaceAll("{host}", view.source.host)
            .replaceAll("{project}", view.source.sourceProjectId)}
        </Text>
      ) : (
        <Text c="dimmed">{ONBOARDING_MESSAGES.settingsSourceNone}</Text>
      )}

      {/* The Disconnect control has existed and worked since setup shipped, on a screen
          that redirects away the moment setup is dismissed. This mount is its entry
          point — the whole of it (D11). */}
      <ConnectAnalyticsForm
        step={ANALYTICS_STEP}
        view={analyticsView(attached)}
        connectionMessage={view.connectionMessage}
        providerInterest={view.providerInterest}
        interestPingAvailable={view.interestPingAvailable}
      />
    </Section>
  );
}

function Delivery({ view }: { view: SettingsView }) {
  const { slack } = view;

  return (
    <Section title={ONBOARDING_MESSAGES.settingsDeliveryGroup}>
      {slack.channelId === null ? (
        <>
          <Text c="dimmed">{ONBOARDING_MESSAGES.settingsNoDelivery}</Text>

          {/* `skippable={false}`: skipping settles a STEP, and there is no step here. */}
          <SlackConnection
            fields={SLACK_CONNECTION_FIELDS}
            settled={false}
            interactive
            skippable={false}
            skipped={false}
            channelId={slack.channelId}
            slackWorkspaceAttached={slack.workspaceAttached}
            slackWorkspaceName={slack.workspaceName}
            slackOAuthAvailable={slack.oauthAvailable}
          />
        </>
      ) : (
        <SlackDeliveryControls channelId={slack.channelId} channelLabel={slack.channelLabel} />
      )}
    </Section>
  );
}

function Excluded({ view }: { view: SettingsView }) {
  const attached = isAnalyticsAttached(view.source.status);

  return (
    <Section title={ONBOARDING_MESSAGES.settingsExcludedGroup}>
      {attached ? (
        <PrivacyReceipt
          input={{
            inferredInternalDomain: view.source.inferredInternalDomain,
            provenance: view.source.internalDomainProvenance,
          }}
        />
      ) : (
        <Text c="dimmed">{ONBOARDING_MESSAGES.settingsExcludedPending}</Text>
      )}
    </Section>
  );
}

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    redirect(ROUTES.signIn);
  }

  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);
  const view = await readSettingsView(db, ctx, projectId);

  return (
    <Container size="sm" py="xl" px="md">
      <Stack gap="lg">
        <Title order={1} size="h3">
          {SETTINGS_TITLE}
        </Title>

        {/* Source first, then delivery, then who is excluded: with nothing to read there is
            nothing to deliver, and exclusions only mean something once both exist. */}
        <Source view={view} />
        <Divider />
        <Delivery view={view} />
        <Divider />
        <Excluded view={view} />

        <AnchorLink href={ROUTES.home} size="sm">
          {ONBOARDING_MESSAGES.settingsBack}
        </AnchorLink>
      </Stack>
    </Container>
  );
}
