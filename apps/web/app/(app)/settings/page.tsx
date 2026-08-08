import { Divider, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import { ensureProject } from "@growthmind/db";
import {
  ANALYTICS_STEP,
  buildAnalyticsCard,
  buildDeliveryCard,
  buildProductCard,
  isAnalyticsAttached,
  ONBOARDING_MESSAGES,
  PAGES_SECTION_TITLE,
  BUSINESS_SECTION_TITLE,
  productActionLabel,
  SETTINGS_TITLE,
  SLACK_CONNECTION_FIELDS,
  type ConnectionCardView,
  type StepView,
} from "@growthmind/shared";

import { ConnectAnalyticsForm } from "@/components/first-run/ConnectAnalyticsForm";
import { ProviderChips } from "@/components/first-run/ProviderChips";
import { LiveRefresh } from "@/components/live/LiveRefresh";
import { BusinessContext } from "@/components/settings/BusinessContext";
import { ConnectionCard } from "@/components/settings/ConnectionCard";
import { PageRoles } from "@/components/settings/PageRoles";
import { PrivacyReceipt } from "@/components/first-run/PrivacyReceipt";
import { SlackConnection } from "@/components/slack/SlackConnection";
import { SlackDeliveryControls } from "@/components/slack/SlackDeliveryControls";
import { AnchorLink } from "@/components/ui/Links";
import { getDb } from "@/lib/db";
import { ROUTES } from "@/lib/routes";
import type { BusinessResearchView } from "@/lib/settings/business";
import { readPageRoles, type PageRoleView } from "@/lib/settings/pages";
import { readBusinessResearch } from "@/lib/settings/site";
import { readSettingsView, type SettingsView } from "@/lib/settings/view";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// The business section owns the control that states the address; the product card names
// the address and sends a reader here rather than offering a second field for one value.
const BUSINESS_ANCHOR = "business";

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <Stack gap="xs" id={id}>
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

function Product({ card, action }: { card: ConnectionCardView; action: string }) {
  return (
    <ConnectionCard view={card}>
      <AnchorLink href={`${ROUTES.settings}#${BUSINESS_ANCHOR}`} size="sm">
        {action}
      </AnchorLink>
    </ConnectionCard>
  );
}

function Source({ view, card }: { view: SettingsView; card: ConnectionCardView }) {
  const attached = isAnalyticsAttached(view.source.status);

  return (
    <ConnectionCard view={card}>
      {/* The Disconnect control has existed and worked since setup shipped, on a screen
          that redirects away the moment setup is dismissed. This mount is its entry
          point — the whole of it (D11). */}
      <ConnectAnalyticsForm
        step={ANALYTICS_STEP}
        view={analyticsView(attached)}
        connectionMessage={null}
        providerInterest={view.providerInterest}
        interestPingAvailable={view.interestPingAvailable}
      />
    </ConnectionCard>
  );
}

function Delivery({ view, card }: { view: SettingsView; card: ConnectionCardView }) {
  const { slack } = view;

  return (
    <ConnectionCard view={card}>
      {slack.channelId === null ? (
        /* `skippable={false}`: skipping settles a STEP, and there is no step here. */
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
      ) : (
        <SlackDeliveryControls channelId={slack.channelId} channelLabel={slack.channelLabel} />
      )}

      {/* Renders nothing while Slack is the only place findings can go. It is here so the
          second destination is a catalogue entry rather than a change to this page. */}
      <ProviderChips
        rail="delivery"
        providerInterest={view.providerInterest}
        interestPingAvailable={view.interestPingAvailable}
        label={ONBOARDING_MESSAGES.providerSoonBadge}
      />
    </ConnectionCard>
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

function Pages({ view, pages }: { view: SettingsView; pages: readonly PageRoleView[] }) {
  return (
    <Section title={PAGES_SECTION_TITLE}>
      <PageRoles pages={pages} sourceAttached={isAnalyticsAttached(view.source.status)} />
    </Section>
  );
}

function Business({ view, site }: { view: SettingsView; site: BusinessResearchView }) {
  return (
    // Named so /audience and the product card can link the website control itself rather
    // than the top of a page it is the last section of.
    <Section title={BUSINESS_SECTION_TITLE} id={BUSINESS_ANCHOR}>
      <BusinessContext view={site} sourceAttached={isAnalyticsAttached(view.source.status)} />
    </Section>
  );
}

export default async function SettingsPage() {
  const ctx = await requireTenantContext();

  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);
  const view = await readSettingsView(db, ctx, projectId);
  const pages = await readPageRoles(db, ctx, projectId);
  const site = await readBusinessResearch(db, ctx, projectId);

  const nowMs = Date.now();
  const { source, slack } = view;

  const product = buildProductCard({
    domain: site.domain,
    researchStatus: site.status,
    pagesSeen: pages.length,
  });

  const analytics = buildAnalyticsCard({
    providerId: source.providerId,
    status: source.status,
    statement: view.connectionMessage,
    host: source.host,
    sourceProjectId: source.sourceProjectId,
    eventsReceived: source.eventsReceived,
    eventsKept: source.eventsKept,
    eventsSetAside: source.eventsSetAside,
    newestSessionAt: source.newestSessionAt,
    lastCheckAt: source.lastCheckAt,
    connectedAt: source.connectedAt,
    pollIntervalSeconds: source.pollIntervalSeconds,
    failure: source.failure,
    nowMs,
  });

  const delivery = buildDeliveryCard({
    providerId: slack.workspaceAttached ? "slack" : null,
    workspaceAttached: slack.workspaceAttached,
    workspaceName: slack.workspaceName,
    channelId: slack.channelId,
    channelLabel: slack.channelLabel,
    connectedAt: slack.connectedAt,
    nowMs,
  });

  return (
    <Stack gap="lg" maw={640}>
      {/* The site read finishes in a worker, minutes after the press that started it, and
          a poll run lands whenever it lands. This is how the page hears about both. */}
      <LiveRefresh topics={["business_context", "first_run"]} />

      <Title order={1} size="h3">
        {SETTINGS_TITLE}
      </Title>

      {/* The customer's own product first, then what reads it, then where what we find
          goes: a vendor's name means nothing until the product it is attached to is named. */}
      <Product card={product} action={productActionLabel(site.domain, site.status)} />
      <Source view={view} card={analytics} />
      <Delivery view={view} card={delivery} />

      <Divider />
      <Excluded view={view} />
      <Divider />

      {/* Last: what the pages are for only means something once something is reading them,
          and what the business will not allow is what makes any of it safe to act on. */}
      <Pages view={view} pages={pages} />
      <Divider />

      <Business view={view} site={site} />

      <AnchorLink href={ROUTES.home} size="sm">
        {ONBOARDING_MESSAGES.settingsBack}
      </AnchorLink>
    </Stack>
  );
}
