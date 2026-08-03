// null = "we have not got a list", [] = "the workspace answered with nothing": different next actions.
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
  ChannelPicker,
  SlackConnection,
  noChannelsVisible,
} from "../../components/slack/SlackConnection";
import type { SlackChannelChoice } from "../../components/first-run/api";

import {
  blankComments,
  SLACK_CONNECTION,
  fixture,
  offenders,
  readFirstRun,
} from "./helpers/first-run-source";
import { stepCardProps } from "./helpers/slack-card";
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

// Rendered directly because renderToStaticMarkup runs no effects: through the card, channels is null and [] is unreachable.
const readPicker = (channels: readonly SlackChannelChoice[] | null): RenderedCard =>
  readMarkup(
    render(
      createElement(ChannelPicker, {
        channels,
        value: null,
        onChange: () => {},
        disabled: false,
      }),
    ),
  );

const pickerMarkup = (channels: readonly SlackChannelChoice[] | null): string =>
  render(
    createElement(ChannelPicker, { channels, value: null, onChange: () => {}, disabled: false }),
  );

const PICKER_CONTROL = /<input\b/;

const CHANNELS: readonly SlackChannelChoice[] = [
  { id: "C01AB2CD3EF", name: "growth" },
  { id: "C09ZY8XW7VU", name: "engineering" },
];

const readPickingCard = (): RenderedCard =>
  readMarkup(
    render(
      createElement(
        SlackConnection,
        stepCardProps({
          channelId: null,
          slackWorkspaceAttached: true,
          slackWorkspaceName: null,
          slackOAuthAvailable: true,
        }),
      ),
    ),
  );

const RELIST_BRANCH = /if\s*\(\s*relistable\s*\)/;

const FAILURE_ONLY_BRANCH = /if\s*\(\s*listUnavailable\s*\)/;

const PLANTED_FAILURE_ONLY_RETRY = fixture(
  "PlantedFailureOnlyRetry",
  `async function retry(): Promise<void> {
  if (listUnavailable) {
    setListingAttempt((attempt) => attempt + 1);
    return;
  }
  await post();
}
`,
);

const CLEAN_RELIST_RETRY = fixture(
  "CleanRelistRetry",
  `async function retry(): Promise<void> {
  if (relistable) {
    setListingAttempt((attempt) => attempt + 1);
    return;
  }
  await post();
}
`,
);

describe("the channel list that arrives empty — the sweep's dead end", () => {
  test("the markup reader sees a rendered picker and does not see a folded-away one", () => {
    const onScreen = readMarkup('<div><label>Channel</label><input id="c"/></div>');
    const foldedAway = readMarkup('<div aria-hidden="true"><label>Channel</label></div>');

    expect(onScreen.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(foldedAway.text).not.toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(PICKER_CONTROL.test('<div><label>Channel</label><input id="c"/></div>')).toBe(true);
    expect(PICKER_CONTROL.test("<div><p>nothing to choose from</p></div>")).toBe(false);
  });

  test("a list that arrived empty and a list that has not arrived are different facts", () => {
    expect(noChannelsVisible(null)).toBe(false);
    expect(noChannelsVisible([])).toBe(true);
    expect(noChannelsVisible(CHANNELS)).toBe(false);
  });

  test("an empty channel list renders the sentence instead of an empty picker", () => {
    const rendered = readPicker([]);

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);

    expect(PICKER_CONTROL.test(pickerMarkup([]))).toBe(false);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackChannelPickPrompt);
  });

  test("a list that has not arrived yet renders the picker and claims nothing about the workspace", () => {
    const rendered = readPicker(null);

    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(PICKER_CONTROL.test(pickerMarkup(null))).toBe(true);
  });

  test("a list with channels in it renders the picker and not the sentence", () => {
    const rendered = readPicker(CHANNELS);

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.slackChannelPickPrompt);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);
    expect(PICKER_CONTROL.test(pickerMarkup(CHANNELS))).toBe(true);
    expect(pickerMarkup(CHANNELS)).toContain(ONBOARDING_MESSAGES.channelPlaceholder);
  });

  test("the delivery card hands the picker its real list and keeps the skip in the row", () => {
    const rendered = readPickingCard();

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);

    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  test("try again re-lists on both list states rather than re-posting", () => {
    expect(offenders([PLANTED_FAILURE_ONLY_RETRY], FAILURE_ONLY_BRANCH)).not.toEqual([]);
    expect(offenders([PLANTED_FAILURE_ONLY_RETRY], RELIST_BRANCH)).toEqual([]);
    expect(offenders([CLEAN_RELIST_RETRY], RELIST_BRANCH)).not.toEqual([]);
    expect(offenders([CLEAN_RELIST_RETRY], FAILURE_ONLY_BRANCH)).toEqual([]);

    const card = readFirstRun(SLACK_CONNECTION);

    expect(offenders([card], RELIST_BRANCH)).not.toEqual([]);
    expect(offenders([card], FAILURE_ONLY_BRANCH)).toEqual([]);

    expect(blankComments(card.source)).toContain("setListingAttempt");
  });
});
