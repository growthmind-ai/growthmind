// A producer test plus a consumer test do not prove a wire; these rows drive the real component.
import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  ONBOARDING_MESSAGES,
  STEP_DESCRIPTORS,
  type StepView,
  type WorkStep,
} from "@growthmind/shared";

import { ConnectSlackForm } from "../../components/first-run/ConnectSlackForm";

import {
  blankComments,
  fixtureAt,
  FIRST_RUN_PAGE,
  offenders,
  readFirstRun,
} from "./helpers/first-run-source";
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

function slackStep(): WorkStep {
  const found = STEP_DESCRIPTORS.find((descriptor) => descriptor.id === "slack");

  if (found === undefined || found.kind !== "work") {
    throw new Error(
      "STEP_DESCRIPTORS carries no `work` step `slack`. Step 3 is the delivery step and it has " +
        "a form; a `coming-next` or missing descriptor here means the sequence changed shape.",
    );
  }

  return found;
}

const ACTIVE_VIEW: StepView = {
  id: "slack",
  ordinal: 3,
  state: "active",
  open: true,
  interactive: true,
};

const readCard = (slackWorkspaceName: string | null): RenderedCard =>
  readMarkup(
    render(
      createElement(ConnectSlackForm, {
        step: slackStep(),
        view: ACTIVE_VIEW,
        channelId: null,
        slackWorkspaceAttached: true,
        slackWorkspaceName,
        slackOAuthAvailable: true,
      }),
    ),
  );

// Props erase at runtime, so the required prop stops only a TS caller; the card must degrade like null, not .trim() undefined.
const readCardWithNoSuchProp = (): RenderedCard => {
  const withoutTheField = {
    step: slackStep(),
    view: ACTIVE_VIEW,
    channelId: null,
    slackWorkspaceAttached: true,
    slackOAuthAvailable: true,
  };

  return readMarkup(
    render(
      createElement(
        ConnectSlackForm as unknown as ComponentType<typeof withoutTheField>,
        withoutTheField,
      ),
    ),
  );
};

const WORKSPACE = "Fixture workspace named only here";

const sentenceFor = (name: string): string =>
  ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate.replaceAll("{workspace}", name);

const NAME_THREADED = /slackWorkspaceName=\{status\.slackWorkspaceName\}/;

const PLANTED_UNTHREADED_PAGE = fixtureAt(
  "apps/web/app/(first-run)/first-run/planted-page.tsx",
  `      <ConnectSlackForm
        step={step}
        view={view}
        channelId={status.channelId}
        slackWorkspaceAttached={status.slackWorkspaceAttached}
        slackOAuthAvailable={status.slackOAuthAvailable}
      />
`,
);

const CLEAN_THREADED_PAGE = fixtureAt(
  "apps/web/app/(first-run)/first-run/clean-page.tsx",
  `      <ConnectSlackForm
        step={step}
        view={view}
        channelId={status.channelId}
        slackWorkspaceAttached={status.slackWorkspaceAttached}
        slackWorkspaceName={status.slackWorkspaceName}
        slackOAuthAvailable={status.slackOAuthAvailable}
      />
`,
);

describe("the workspace name's wire — driven from both ends", () => {
  test("the markup reader reads real words and does not read a folded-away one", () => {
    const onScreen = readMarkup(`<div><p>${sentenceFor(WORKSPACE)}</p></div>`);
    const foldedAway = readMarkup(`<div aria-hidden="true"><p>${sentenceFor(WORKSPACE)}</p></div>`);

    expect(onScreen.text).toContain(WORKSPACE);
    expect(foldedAway.text).not.toContain(WORKSPACE);
  });

  test("the copy home owns the sentence and it carries the interpolation token", () => {
    expect(ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate).toContain("{workspace}");
    expect(sentenceFor(WORKSPACE)).toContain(WORKSPACE);
    expect(sentenceFor(WORKSPACE)).not.toContain("{workspace}");
  });

  test("a workspace with a name renders the name beside the channel picker", () => {
    const rendered = readCard(WORKSPACE);

    expect(rendered.text).toContain(sentenceFor(WORKSPACE));

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);

    expect(rendered.text).not.toContain("{workspace}");
  });

  test("the pasted-token path has no name and renders nothing rather than an empty hole", () => {
    const rendered = readCard(null);

    expect(rendered.text).not.toContain("{workspace}");
    expect(rendered.text).not.toContain("null");
    expect(rendered.text).not.toContain("undefined");
    expect(rendered.text).not.toContain(sentenceFor("").trim());

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
  });

  test("a stored name that is blank is the same absence as no name at all", () => {
    const blank = readCard("   ");

    expect(blank.text).not.toContain(sentenceFor("").trim());
    expect(blank.text).toContain(ONBOARDING_MESSAGES.channelLabel);

    const absent = readCardWithNoSuchProp();

    expect(absent.text).not.toContain(sentenceFor("").trim());
    expect(absent.text).toContain(ONBOARDING_MESSAGES.channelLabel);
  });

  test("two different workspaces do not render the same card", () => {
    expect(readCard(WORKSPACE).text).not.toBe(readCard("Somewhere else entirely").text);
    expect(readCard(WORKSPACE).text).not.toBe(readCard(null).text);
  });

  test("the server page passes the payload's own field into the card", () => {
    expect(offenders([PLANTED_UNTHREADED_PAGE], NAME_THREADED)).toEqual([]);
    expect(offenders([CLEAN_THREADED_PAGE], NAME_THREADED)).not.toEqual([]);

    const page = readFirstRun(FIRST_RUN_PAGE);

    expect(offenders([page], NAME_THREADED)).not.toEqual([]);
    expect(blankComments(page.source)).toContain("slackWorkspaceName");
  });
});
