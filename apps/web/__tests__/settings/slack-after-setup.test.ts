// B-035: three screens tell a founder who skipped Slack to connect one, and the
// product offered nowhere to do it. These rows drive the real card with the real
// settings props — a page that renders and a card that renders no control is the
// exact shape the bug had.
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  buildDeliveryCard,
  ONBOARDING_MESSAGES,
  SLACK_CONNECTION_FIELDS,
} from "@growthmind/shared";

import { SlackConnection } from "../../components/slack/SlackConnection";
import { blankComments, readExisting } from "../first-run/helpers/first-run-source";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";
import type { SlackCardFacts } from "../first-run/helpers/slack-card";

const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

const render = (node: ReactElement): string =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AppRouterContext.Provider, { value: FAKE_ROUTER }, node),
    ),
  );

// What `apps/web/app/settings/page.tsx` passes: never skippable, always
// interactive, and settled only when there is somewhere to deliver.
const settingsCardProps = (facts: SlackCardFacts) => ({
  fields: SLACK_CONNECTION_FIELDS,
  settled: facts.channelId !== null,
  interactive: true,
  skippable: false,
  skipped: false,
  ...facts,
});

const readCard = (facts: SlackCardFacts): RenderedCard =>
  readMarkup(render(createElement(SlackConnection, settingsCardProps(facts))));

const SKIPPED_SELF_HOSTED: SlackCardFacts = {
  channelId: null,
  slackWorkspaceAttached: false,
  slackWorkspaceName: null,
  slackOAuthAvailable: false,
};

const SKIPPED_HOSTED: SlackCardFacts = { ...SKIPPED_SELF_HOSTED, slackOAuthAvailable: true };

const WORKSPACE_NO_CHANNEL: SlackCardFacts = {
  channelId: null,
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
};

const CONNECTED: SlackCardFacts = {
  channelId: "C01AB2CD3EF",
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
};

const ADD_TO_SLACK = /\badd\b[\s\S]{0,32}?\bto slack\b/i;

const SETTINGS_PAGE = "apps/web/app/(app)/settings/page.tsx";
const LANDING_PAGE = "apps/web/app/(app)/page.tsx";
const SETTLED_PANEL = "apps/web/components/landing/settled-panel.tsx";

const settingsSource = (): string => blankComments(readExisting(SETTINGS_PAGE).source);

describe("B-035 — somewhere to connect Slack after setup has retired", () => {
  test("a founder who skipped Slack on a self-hosted install is given the token form", () => {
    const rendered = readCard(SKIPPED_SELF_HOSTED);

    for (const field of SLACK_CONNECTION_FIELDS) {
      expect(rendered.text).toContain(field.label);
    }
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.sendTestMessage);
  });

  test("a founder who skipped Slack on a hosted install is given the one-click path", () => {
    expect(
      readCard(SKIPPED_HOSTED).controls.filter((label) => ADD_TO_SLACK.test(label)),
    ).not.toEqual([]);
  });

  test("a workspace attached with no channel yet is given the picker", () => {
    expect(readCard(WORKSPACE_NO_CHANNEL).text).toContain(ONBOARDING_MESSAGES.channelLabel);
  });

  test("no state of this page offers to skip — there is no step left to skip", () => {
    for (const facts of [SKIPPED_SELF_HOSTED, SKIPPED_HOSTED, WORKSPACE_NO_CHANNEL, CONNECTED]) {
      expect(readCard(facts).controls).not.toContain(ONBOARDING_MESSAGES.skipForNow);
    }
  });

  test("an organization that already delivers somewhere is offered no second address", () => {
    const rendered = readCard(CONNECTED);

    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.controls).toEqual([]);
  });

  test("the page mounts the card unskippable and interactive, and names where it posts", () => {
    const code = settingsSource();
    const controls = blankComments(
      readExisting("apps/web/components/slack/SlackDeliveryControls.tsx").source,
    );

    expect(code).toContain("<SlackConnection");
    expect(code).toMatch(/skippable=\{false\}/);
    expect(code).toMatch(/\binteractive\b/);

    // The posting sentence lives on the settled control — the only state with an address.
    expect(controls).toContain("settingsPostingTemplate");
  });

  // The sentence used to be mounted by the page; it is now the delivery card's own
  // statement, so it is asserted where it is decided rather than where it is rendered.
  test("a founder with no workspace is still told findings have nowhere to arrive", () => {
    const card = buildDeliveryCard({
      providerId: null,
      workspaceAttached: false,
      workspaceName: null,
      channelId: null,
      channelLabel: null,
      connectedAt: null,
      nowMs: Date.parse("2026-08-07T12:00:00Z"),
    });

    expect(card.statement).toBe(ONBOARDING_MESSAGES.settingsNoDelivery);
  });

  // B-035 was a control nobody could reach. The card that names Slack is the same class
  // of miss one layer up: the workspace was read and never rendered, so the section said
  // a channel and never which product it belonged to (D11).
  test("a connected workspace names Slack, not only the channel", () => {
    const card = buildDeliveryCard({
      providerId: "slack",
      workspaceAttached: true,
      workspaceName: "Acme",
      channelId: "C01AB2CD3EF",
      channelLabel: "issues",
      connectedAt: new Date("2026-08-04T12:00:00Z"),
      nowMs: Date.parse("2026-08-07T12:00:00Z"),
    });

    expect(card.headline).toBe("Slack");
    expect(card.facts.map((fact) => fact.value)).toContain("Acme");
  });

  test("the page reads the connection at organization scope, so a teammate can finish it", () => {
    const reader = blankComments(readExisting("apps/web/lib/settings/slack.ts").source);

    expect(reader).toContain("getActiveForOrg");
    expect(reader).toContain("isDeliveryTarget");

    // The page reads through the whole-page view now; the Slack read is one of its three.
    expect(settingsSource()).toContain("readSettingsView");
    expect(blankComments(readExisting("apps/web/lib/settings/view.ts").source)).toContain(
      "readSlackSettings",
    );
  });

  test("the landing page a dismissed founder lands on links here", () => {
    const landing = blankComments(readExisting(LANDING_PAGE).source);
    const panel = blankComments(readExisting(SETTLED_PANEL).source);

    // The link lives in the panel; the gate that decides whether the panel
    // renders at all lives on the page, and it is the dismissal.
    expect(landing).toContain("<SettledPanel");
    expect(landing).toMatch(/dismissed\s*\?[\s\S]{0,200}?<SettledPanel/);
    expect(panel).toContain("ROUTES.settings");
  });

  test("every capability setup configured has an entry point on this page", () => {
    const code = settingsSource();

    // Each name below is a control that existed, worked, and was unreachable (D11).
    expect(code).toContain("<ConnectAnalyticsForm");
    expect(code).toContain("<PrivacyReceipt");
    expect(code).toContain("<SlackDeliveryControls");

    // Each rail gets a card that names the product behind it — the group titles that
    // named only the rail ("What it reads") never said who was being read.
    for (const card of ["buildProductCard", "buildAnalyticsCard", "buildDeliveryCard"]) {
      expect(code).toContain(card);
    }

    expect(code).toContain("settingsExcludedGroup");
  });

  test("the terminal setup state mounts the card itself rather than linking away", () => {
    const client = blankComments(
      readExisting("apps/web/components/first-run/FirstRunClient.tsx").source,
    );

    // A link would send an un-dismissed founder to /settings, whose exit is `/`,
    // which renders the pre-setup CTA — a reset, from the terminal state.
    expect(client).toContain("<SlackConnection");
    expect(client).toMatch(/terminal\s*&&\s*current\.channelId === null/);
    expect(client).not.toContain("ROUTES.settings");
  });

  test("the OAuth return lands on the surface the founder left, not always on setup", () => {
    const outcome = blankComments(
      readExisting("apps/web/lib/first-run/slack-oauth-outcome.ts").source,
    );
    const callback = blankComments(
      readExisting("apps/web/app/api/first-run/slack/oauth/callback/route.ts").source,
    );

    // `/first-run` redirects a dismissed founder home and drops the query, so a
    // hardcoded landing swallowed all six outcome sentences on /settings — the
    // one-click path this page exists to offer.
    expect(outcome).toContain("ROUTES.settings");
    expect(outcome).toMatch(/dismissed\s*\?\s*ROUTES\.settings\s*:\s*ROUTES\.firstRun/);
    expect(callback).toContain("isDismissed");
    expect(callback).not.toContain("firstRunLandingFor");
  });

  test("a post that failed keeps the control its own error sentence names", () => {
    const card = blankComments(
      readExisting("apps/web/components/slack/SlackConnection.tsx").source,
    );

    // The channel route answers 200 with the failure inside it (D8), so the
    // address lands and `settled` arrives true on the render that must retry.
    expect(card).toMatch(/const\s+postFailed\s*=\s*outcome !== null && !outcome\.ok/);
    expect(card).toMatch(/const\s+settled\s*=\s*props\.settled && !postFailed/);
  });

  test("the connected state says what became true, and the channel can be moved", () => {
    const controls = blankComments(
      readExisting("apps/web/components/slack/SlackDeliveryControls.tsx").source,
    );

    expect(controls).toContain("settingsSettled");

    // Frozen before, because moving forks `(finding, channel)` and replays the backlog
    // (D12). It moves now because the move stamps a cutover — not because the risk went.
    expect(controls).toContain("settingsChannelChange");
    expect(controls).toContain("settingsChannelChangeConsequence");
    expect(controls).toContain("SETTINGS_API.slackChannel");
  });

  test("the consequence of moving is readable before the move, not after it", () => {
    // Nobody can consent to "we will not re-send what we already sent" if the sentence
    // only appears once the address has changed.
    expect(ONBOARDING_MESSAGES.settingsChannelChangeConsequence).toMatch(/before/i);
    expect(ONBOARDING_MESSAGES.settingsChannelMovedTemplate).toContain("{channel}");
  });

  test("the posting sentence is a claim about the address, not about the last post", () => {
    // "is posted to" contradicted the failure sentence rendered beneath it.
    expect(ONBOARDING_MESSAGES.settingsPostingTemplate).toContain("{channel}");
    expect(ONBOARDING_MESSAGES.settingsPostingTemplate).not.toMatch(/\bis posted\b/);
  });

  test("an unreadable connection degrades to the connect path, never to an error screen", () => {
    const reader = blankComments(readExisting("apps/web/lib/settings/slack.ts").source);

    // There is no error.tsx anywhere under app/, so a driver throw here would be
    // the framework's error page on the only surface that can attach a channel.
    expect(reader).toMatch(/catch\s*\(/);
    expect(reader).toContain("describeDriverError");
  });
});
