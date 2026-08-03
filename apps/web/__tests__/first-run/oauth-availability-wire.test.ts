import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import {
  assertUnderConstruction,
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  blankComments,
  SLACK_CONNECTION,
  fixture,
  fixtureAt,
  FIRST_RUN_COMPONENTS,
  offenders,
  readAll,
  readFirstRun,
  webSources,
  type ScannedFile,
} from "./helpers/first-run-source";
import { readMarkup, type RenderedCard } from "./helpers/rendered-markup";
import { slackFields, stepCardProps, type SlackCardProps } from "./helpers/slack-card";

const OWNER = "ADD Wave 6, task 6.2 (apps/web/components/slack/SlackConnection.tsx, AD-6)";

type DeliveryCardProps = SlackCardProps;

const loadDeliveryCard = (): Promise<ComponentType<DeliveryCardProps>> =>
  loadValueUnderConstruction<ComponentType<DeliveryCardProps>>({
    modulePath: underConstructionSpecifier("apps/web/components/slack/SlackConnection"),
    exportName: "SlackConnection",
    ownedBy: OWNER,
  });

// Props erase at runtime; today's card IS the false branch, so without this the row greens vacuously.
function deliveryCardTakesTheFlag(): void {
  const source = blankComments(readFirstRun(SLACK_CONNECTION).source);

  assertUnderConstruction(/\bslackOAuthAvailable\b/.test(source), {
    contract:
      "the delivery card takes `slackOAuthAvailable` and branches on it — today it takes " +
      "its fields, its settled/interactive flags and `channelId` only, so the flag is a wire " +
      "with one end unattached (AD-6, D11)",
    ownedBy: OWNER,
  });
}

const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

function renderDeliveryCard(
  Card: ComponentType<DeliveryCardProps>,
  slackOAuthAvailable: boolean,
): RenderedCard {
  return readMarkup(
    renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(
          AppRouterContext.Provider,
          { value: FAKE_ROUTER },
          createElement(
            Card,
            stepCardProps({
              channelId: null,
              slackWorkspaceAttached: false,
              slackWorkspaceName: null,
              slackOAuthAvailable,
            }),
          ),
        ),
      ),
    ),
  );
}

const MARKUP_ON_SCREEN =
  "<div><style>.x{display:none}</style>" +
  '<label for="t">Bot token</label><input id="t"/>' +
  '<button type="button"><span><span>Send a test message</span></span></button></div>';

const MARKUP_FOLDED_AWAY =
  '<div><button type="button"><span>Add to Slack</span></button>' +
  '<div style="height:0;overflow:hidden;display:none" aria-hidden="true" inert="">' +
  '<label for="t">Bot token</label></div>' +
  "<details><summary>No Slack app?</summary><label>Bot token</label></details>" +
  '<div aria-hidden="true"><span>Send a test message</span></div></div>';

interface Ban {
  readonly name: string;
  readonly pattern: RegExp;
}

// Each scan asserts an absence that is already true — its planted offender is what keeps it honest.
const CLIENT_ENV_BANS: readonly Ban[] = [
  { name: "process.env", pattern: /process\s*\.\s*env\b/ },
  { name: "a NEXT_PUBLIC_ variable", pattern: /\bNEXT_PUBLIC_[A-Z0-9_]+/ },
  { name: "the Slack app credentials", pattern: /\bSLACK_CLIENT_(?:ID|SECRET)\b/ },
];

const envReadsIn = (files: readonly ScannedFile[]): readonly string[] =>
  CLIENT_ENV_BANS.flatMap(({ pattern }) => offenders(files, pattern));

// Scoped to the NEXT_PUBLIC_ twin on purpose: Wave 4's OAuth module reads the private names server-side and must stay free to.
const publishedSlackCredentials = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(files, /\bNEXT_PUBLIC_SLACK[A-Z0-9_]*/);

const PLANTED_ENV_CLIENT = fixture(
  "PlantedEnvClient",
  `"use client";
import { Button } from "@mantine/core";

export function SlackConnection() {
  // Reaching for the variable directly, one component deep.
  const available = process.env.SLACK_CLIENT_ID !== undefined;
  const publicId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;

  return available ? <Button>Add to Slack</Button> : <Button>{publicId}</Button>;
}
`,
);

const CLEAN_ENV_CLIENT = fixture(
  "CleanEnvClient",
  `"use client";
import { Button } from "@mantine/core";

export function SlackConnection({ slackOAuthAvailable }: { slackOAuthAvailable: boolean }) {
  return slackOAuthAvailable ? <Button>Add to Slack</Button> : <Button>Send a test message</Button>;
}
`,
);

const PLANTED_PUBLIC_CREDENTIAL = fixtureAt(
  "apps/web/lib/slack/planted-oauth.ts",
  `export const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID ?? "";\n`,
);

const CLEAN_PRIVATE_CREDENTIAL = fixtureAt(
  "apps/web/lib/slack/clean-oauth.ts",
  `import { env } from "@growthmind/shared";\n\nexport const clientId = env.SLACK_CLIENT_ID;\n`,
);

const ADD_TO_SLACK = /\badd\b[\s\S]{0,32}?\bto slack\b/i;

const named = (controls: readonly string[], pattern: RegExp): readonly string[] =>
  controls.filter((label) => pattern.test(label));

describe("AD-6's delivery-card wire — slackOAuthAvailable, driven from both ends", () => {
  test("the markup reader separates what is on the screen from what is folded away", () => {
    const onScreen = readMarkup(MARKUP_ON_SCREEN);
    const foldedAway = readMarkup(MARKUP_FOLDED_AWAY);

    expect(onScreen.text).toContain("Bot token");
    expect(onScreen.controls).toContain("Send a test message");

    expect(onScreen.text).not.toContain("display:none");

    expect(foldedAway.text).not.toContain("Bot token");
    expect(foldedAway.text).not.toContain("Send a test message");
    expect(foldedAway.controls).toContain("No Slack app?");
    expect(named(foldedAway.controls, ADD_TO_SLACK)).not.toEqual([]);
  });

  test("with no Slack app configured the pasted-token form is the card, not a fallback", async () => {
    deliveryCardTakesTheFlag();

    expect(readMarkup(MARKUP_ON_SCREEN).text).toContain("Bot token");

    const Card = await loadDeliveryCard();
    const rendered = renderDeliveryCard(Card, false);
    for (const field of slackFields()) {
      expect(rendered.text).toContain(field.label);
    }
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.sendTestMessage);

    expect(named(rendered.controls, ADD_TO_SLACK)).toEqual([]);
  });

  test("with a Slack app configured the card offers Add to Slack and folds the token form away", async () => {
    deliveryCardTakesTheFlag();

    expect(readMarkup(MARKUP_FOLDED_AWAY).text).not.toContain("Bot token");
    expect(readMarkup(MARKUP_ON_SCREEN).text).toContain("Bot token");

    const Card = await loadDeliveryCard();
    const rendered = renderDeliveryCard(Card, true);
    expect(named(rendered.controls, ADD_TO_SLACK)).not.toEqual([]);

    for (const field of slackFields()) {
      expect(rendered.text).not.toContain(field.label);
    }

    const disclosures = rendered.controls.filter(
      (label) => !ADD_TO_SLACK.test(label) && label !== ONBOARDING_MESSAGES.skipForNow,
    );

    expect(disclosures).not.toEqual([]);
  });

  test("skip for now is in the row on both delivery paths", async () => {
    deliveryCardTakesTheFlag();

    const Card = await loadDeliveryCard();

    expect(renderDeliveryCard(Card, false).controls).toContain(ONBOARDING_MESSAGES.skipForNow);
    expect(renderDeliveryCard(Card, true).controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  test("the two values of the flag do not render the same card", async () => {
    deliveryCardTakesTheFlag();

    const Card = await loadDeliveryCard();

    expect(renderDeliveryCard(Card, true).text).not.toBe(renderDeliveryCard(Card, false).text);
  });

  test("no first-run client component reads process.env", () => {
    expect(envReadsIn([PLANTED_ENV_CLIENT])).not.toEqual([]);
    expect(envReadsIn([CLEAN_ENV_CLIENT])).toEqual([]);

    expect(
      envReadsIn([fixture("Comment", "// the flag comes from the payload, never process.env\n")]),
    ).toEqual([]);

    expect(envReadsIn(readAll(FIRST_RUN_COMPONENTS))).toEqual([]);
  });

  test("no Slack app credential is published to the browser bundle", () => {
    expect(publishedSlackCredentials([PLANTED_PUBLIC_CREDENTIAL])).not.toEqual([]);
    expect(publishedSlackCredentials([CLEAN_PRIVATE_CREDENTIAL])).toEqual([]);

    expect(publishedSlackCredentials(webSources())).toEqual([]);
  });
});
