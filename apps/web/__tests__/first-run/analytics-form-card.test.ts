// Step 2's card had no render test: it was covered only by whole-tree source scans,
// so nothing proved the earned self-host field stays folded until it is earned.
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { STEP_DESCRIPTORS, type StepView, type WorkStep } from "@growthmind/shared";

import { ConnectAnalyticsForm } from "../../components/first-run/ConnectAnalyticsForm";

import { readMarkup, type RenderedCard } from "./helpers/rendered-markup";

// Server-supplied at runtime, so the test supplies its own and asserts it reaches the card.
const CONNECTION_SENTENCE = "db-analytics-card-connection-sentence";

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

function analyticsStep(): WorkStep {
  const found = STEP_DESCRIPTORS.find((descriptor) => descriptor.id === "analytics");

  if (found === undefined || found.kind !== "work") {
    throw new Error(
      "STEP_DESCRIPTORS carries no `work` step `analytics`. Step 2 is the connect step and it " +
        "has a form; a missing or `coming-next` descriptor here means the sequence changed shape.",
    );
  }

  return found;
}

const ACTIVE_VIEW: StepView = {
  id: "analytics",
  ordinal: 2,
  state: "active",
  open: true,
  interactive: true,
};

const DONE_VIEW: StepView = { ...ACTIVE_VIEW, state: "done" };

function card(view: StepView): RenderedCard {
  return readMarkup(
    render(
      createElement(ConnectAnalyticsForm, {
        step: analyticsStep(),
        view,
        connectionMessage: CONNECTION_SENTENCE,
      }),
    ),
  );
}

const STEP = analyticsStep();

const VISIBLE_FIELD = STEP.fields.find((field) => !field.folded);
const FOLDED_FIELD = STEP.fields.find((field) => field.folded);

describe("the analytics card — one visible field, one earned", () => {
  test("the step descriptor still carries exactly one visible field and one folded one", () => {
    expect(VISIBLE_FIELD?.id).toBe("personalKey");
    expect(FOLDED_FIELD?.id).toBe("regionAddress");
  });

  test("an active card asks for the visible field and never names the earned one", () => {
    const rendered = card(ACTIVE_VIEW);

    expect(rendered.text).toContain(VISIBLE_FIELD?.label ?? "");

    // AD-2: the self-host address is earned by two refused region walks. Before
    // that it is not on the screen at all — a closed Collapse renders nothing.
    expect(rendered.text).not.toContain(FOLDED_FIELD?.label ?? "");
  });

  test("an active card offers the connect action", () => {
    const rendered = card(ACTIVE_VIEW);

    expect(rendered.controls.join(" ")).toContain(STEP.actions[0]?.label ?? "");
  });

  test("every rendered input carries the placeholder its descriptor declares", () => {
    const html = render(
      createElement(ConnectAnalyticsForm, {
        step: STEP,
        view: ACTIVE_VIEW,
        connectionMessage: CONNECTION_SENTENCE,
      }),
    );

    expect(html).toContain(`placeholder="${VISIBLE_FIELD?.placeholder ?? ""}"`);
  });

  test("the shared tap target reaches the rendered input, not just the source file", () => {
    // The style contract only asserts the file names the symbol; this asserts it lands.
    const html = render(
      createElement(ConnectAnalyticsForm, {
        step: STEP,
        view: ACTIVE_VIEW,
        connectionMessage: CONNECTION_SENTENCE,
      }),
    );

    expect(html).toContain("touch-action:manipulation");
  });

  test("a secret field renders as a password input, never as plain text", () => {
    const html = render(
      createElement(ConnectAnalyticsForm, {
        step: STEP,
        view: ACTIVE_VIEW,
        connectionMessage: CONNECTION_SENTENCE,
      }),
    );

    expect(VISIBLE_FIELD?.secret).toBe(true);
    expect(html).toContain('type="password"');
  });

  test("an attached card shows the connection sentence and stops asking for the key", () => {
    const rendered = card(DONE_VIEW);

    expect(rendered.text).toContain(CONNECTION_SENTENCE);
    expect(rendered.text).not.toContain(VISIBLE_FIELD?.label ?? "");
  });

  test("a non-interactive card renders no enabled control", () => {
    const html = render(
      createElement(ConnectAnalyticsForm, {
        step: STEP,
        view: { ...ACTIVE_VIEW, interactive: false },
        connectionMessage: CONNECTION_SENTENCE,
      }),
    );

    expect(html).toContain("disabled");
  });
});
