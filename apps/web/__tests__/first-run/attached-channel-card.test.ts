// The invariant: the pasted-token form NEVER renders on an organization with a workspace attached.
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import {
  channelAddressLanded,
  SlackConnection,
  type SendAnswer,
} from "../../components/slack/SlackConnection";

import {
  blankComments,
  SLACK_CONNECTION,
  fixture,
  offenders,
  readFirstRun,
} from "./helpers/first-run-source";
import { stepCardProps, type SlackCardFacts } from "./helpers/slack-card";
import { readMarkup, type RenderedCard } from "./helpers/rendered-markup";

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

const TYPED_FIELD = /<input\b/;

type CardState = SlackCardFacts;

const cardMarkup = (state: CardState): string =>
  render(createElement(SlackConnection, stepCardProps(state)));

const readCard = (state: CardState): RenderedCard => readMarkup(cardMarkup(state));

const ATTACHED_AND_UNSETTLED: CardState = {
  channelId: "C01AB2CD3EF",
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
};

const PICKING: CardState = {
  channelId: null,
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
};

const NOTHING_ATTACHED: CardState = {
  channelId: null,
  slackWorkspaceAttached: false,
  slackWorkspaceName: null,
  slackOAuthAvailable: false,
};

const LANDED_BRANCH = /if\s*\(\s*channelAddressLanded\(/;

const COMBINED_BOOLEAN = /if\s*\(\s*await\s+sendTo\(/;

const PLANTED_COMBINED_BOOLEAN = fixture(
  "PlantedCombinedBoolean",
  `async function send(): Promise<void> {
  if (await sendTo(FIRST_RUN_API.slackChannel, { channelId: choice ?? "" })) {
    setChannelNow(true);
  }
}
`,
);

const sendAnswer = (over: Partial<SendAnswer>): SendAnswer => ({
  posted: false,
  code: null,
  marksStepDone: false,
  ...over,
});

const CLEAN_SPLIT = fixture(
  "CleanSplit",
  `async function send(): Promise<void> {
  const answer = await sendTo(FIRST_RUN_API.slackChannel, { channelId: choice ?? "" });
  if (channelAddressLanded(answer)) {
    setChannelNow(true);
    router.refresh();
  }
}
`,
);

describe("the card after the address is stamped — CR-3's dead end", () => {
  test("the markup reader and the field scan can both see a form that is there", () => {
    const onScreen = readCard(NOTHING_ATTACHED);

    expect(onScreen.text).toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(onScreen.text).toContain(ONBOARDING_MESSAGES.channelIdLabel);
    expect(TYPED_FIELD.test(cardMarkup(NOTHING_ATTACHED))).toBe(true);
    expect(TYPED_FIELD.test("<div><p>nothing to type into</p></div>")).toBe(false);
  });

  test("an attached workspace with a stamped channel is never shown the pasted-token form", () => {
    const rendered = readCard(ATTACHED_AND_UNSETTLED);

    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelIdLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelIdHelper);

    expect(TYPED_FIELD.test(cardMarkup(ATTACHED_AND_UNSETTLED))).toBe(false);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackChannelPickPrompt);

    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.sendTestMessage);
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  test("an attached workspace with no channel yet is still shown the picker", () => {
    const rendered = readCard(PICKING);

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  test("the address landing is decided by the attach, never by the post succeeding", () => {
    expect(channelAddressLanded(sendAnswer({ posted: true, marksStepDone: true }))).toBe(true);
    expect(channelAddressLanded(sendAnswer({ posted: true }))).toBe(true);

    expect(channelAddressLanded(sendAnswer({ code: "channel_already_chosen" }))).toBe(true);

    expect(channelAddressLanded(sendAnswer({ code: "channel_not_listed" }))).toBe(false);
    expect(channelAddressLanded(sendAnswer({ code: "no_workspace_connected" }))).toBe(false);
    expect(channelAddressLanded(sendAnswer({ code: "channels_call_failed" }))).toBe(false);
    expect(channelAddressLanded(sendAnswer({}))).toBe(false);
  });

  test("the channel press asks the address, not the post, and refreshes on it", () => {
    expect(offenders([PLANTED_COMBINED_BOOLEAN], COMBINED_BOOLEAN)).not.toEqual([]);
    expect(offenders([PLANTED_COMBINED_BOOLEAN], LANDED_BRANCH)).toEqual([]);
    expect(offenders([CLEAN_SPLIT], LANDED_BRANCH)).not.toEqual([]);
    expect(offenders([CLEAN_SPLIT], COMBINED_BOOLEAN)).toEqual([]);

    const card = readFirstRun(SLACK_CONNECTION);

    expect(offenders([card], LANDED_BRANCH)).not.toEqual([]);
    expect(offenders([card], COMBINED_BOOLEAN)).toEqual([]);

    const code = blankComments(card.source);
    expect(code).toContain("setChannelNow(true)");
    expect(code).toContain("router.refresh()");
  });
});
