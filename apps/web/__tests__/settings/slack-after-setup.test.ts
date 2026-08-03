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

import { ONBOARDING_MESSAGES, SLACK_CONNECTION_FIELDS } from "@growthmind/shared";

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

const SETTINGS_PAGE = "apps/web/app/settings/page.tsx";
const LANDING_PAGE = "apps/web/app/page.tsx";
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

    expect(code).toContain("<SlackConnection");
    expect(code).toMatch(/skippable=\{false\}/);
    expect(code).toMatch(/\binteractive\b/);
    expect(code).toContain("SETTINGS_POSTING_TEMPLATE");
    expect(code).toContain("SETTINGS_NO_DELIVERY_LINE");
  });

  test("the page reads the connection at organization scope, so a teammate can finish it", () => {
    const reader = blankComments(readExisting("apps/web/lib/settings/slack.ts").source);

    expect(reader).toContain("getActiveForOrg");
    expect(reader).toContain("isDeliveryTarget");

    expect(settingsSource()).toContain("readSlackSettings");
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

  test("the terminal setup state offers the same control beside Done", () => {
    const client = blankComments(
      readExisting("apps/web/components/first-run/FirstRunClient.tsx").source,
    );

    expect(client).toContain("ROUTES.settings");
  });
});
