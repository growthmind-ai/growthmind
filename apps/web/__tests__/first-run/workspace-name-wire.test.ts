// `slackWorkspaceName`, DRIVEN FROM BOTH ENDS — CR-1.
//
// ###########################################################################
// # WHY THIS FILE IS NOT A PRODUCER TEST AND NOT A CONSUMER TEST.
// #
// # The producer chain for this field was complete and green before a single
// # line of it reached a screen: a migration added the column, the repository
// # writes it, the summary maps it, and `lib/first-run/status.ts` puts it on
// # the payload. A route test asserted that the name Slack returned is
// # PERSISTED. Every one of those passed, and a founder with two Slack
// # workspaces still could not tell which one they had just connected, because
// # the card took no such prop and no sentence named it.
// #
// # That is D11 exactly: a value one surface computes for a different surface
// # to read, connected only by a hand-passed field, with tests at both ends and
// # nothing testing the wire. The persistence row proves the column; it says
// # nothing about whether anything renders.
// #
// # So the rows below drive the REAL card, at both values of the field, and
// # assert the two renders differ in the way the sentence says they must. A
// # card that ignores the prop renders identically twice, and that is the
// # severed wire, caught.
// ###########################################################################
//
// ── A REAL RENDERER, NOT A FUNCTION CALL ───────────────────────────────────
//
// The delivery card calls `useState` and `useRouter`, so it is NOT a hook-free
// pure component and MUST NOT be invoked as a plain function — that pattern
// produces `Invalid hook call`, and the two ways to "fix" it (globally
// suppressing the error, or monkeypatching React's dispatcher) hollow out every
// component test in the repository while reporting green. See `REVIEW.md`
// ("Tests": a test that mocks the boundary proves your mock's behaviour, not
// the boundary's) and `.agents/skills/writing-a-unit-test/SKILL.md` ("Drive the
// real entry point").
//
// This file therefore renders through `react-dom/server` inside the two
// providers the card's own tree needs — `MantineProvider` and Next's
// `AppRouterContext`, carrying a FAKE router of six no-op methods. Nothing in
// the harness is patched; the providers are the same ones the running app
// mounts. Effects do not run and clicks cannot be dispatched, so every
// assertion is about FIRST RENDER, which is precisely what this is about: what
// a founder reads in the seconds after Slack hands them back.
//
// ── AND THE OTHER END, WHICH A RENDER CANNOT SEE ───────────────────────────
//
// A render proves the card USES the prop. It cannot prove anybody PASSES it —
// the page could stop threading the field tomorrow and every row below would
// still be green, which is the same severed wire one level up. The source row
// at the bottom scans the server page for the attribute, with a planted
// offender and a clean fixture asserted first, because a scanner separated from
// its controls is a scanner nobody can see is vacuous.
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

// ===========================================================================
// The tree every row renders through
// ===========================================================================

/** Six real no-op methods, handed through Next's own context. Not a mock. */
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

/**
 * The SHIPPED descriptor, not a hand-written one — so the card renders against
 * the step it renders against in production.
 */
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

/** Step 3, open and accepting input. */
const ACTIVE_VIEW: StepView = {
  id: "slack",
  ordinal: 3,
  state: "active",
  open: true,
  interactive: true,
};

/**
 * The card in the window AD-4 opens: a workspace attached, no channel chosen.
 *
 * THE ONLY STATE THE SENTENCE RENDERS IN, and the state a founder lands in
 * coming back from the consent screen — which is the whole reason the name is
 * worth a sentence at all.
 */
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

/**
 * The same card rendered by a caller that does not pass the field AT ALL.
 *
 * THE CAST IS THE POINT AND IT IS NOT A LIE ABOUT THE TYPE. A React
 * component's accepted props are erased at runtime, so the required prop stops
 * a TypeScript caller and nothing else: a payload parsed from JSON written
 * before the field existed, or any caller outside this typecheck, hands
 * `undefined`. The card must degrade to the same nothing an explicit `null`
 * gives — a `=== null` test would reach `.trim()` on it and take the whole
 * delivery step down, which is worse than the missing sentence. AD-6's own
 * suite already renders this card through a props mirror without the field,
 * so this shape is not hypothetical; this row is what states it deliberately.
 */
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

/**
 * A name nothing else in this tree contains.
 *
 * A card that rendered the organization's own name, a constant, or the word
 * "workspace" would pass a row asserting "something is on the screen"; it
 * cannot pass one asserting this.
 */
const WORKSPACE = "Fixture workspace named only here";

/** The shipped sentence, filled the way the card fills it. */
const sentenceFor = (name: string): string =>
  ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate.replaceAll("{workspace}", name);

// ===========================================================================
// The page's own end of the wire, scanned — with its controls
// ===========================================================================

/** The attribute, and the payload field it must be fed from. */
const NAME_THREADED = /slackWorkspaceName=\{status\.slackWorkspaceName\}/;

/** The card rendered with every OTHER Slack fact and this one left off. */
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

// ###########################################################################
describe("the workspace name's wire — driven from both ends", () => {
  // ------------------------------------------------------------------ reader
  test("the markup reader reads real words and does not read a folded-away one", () => {
    // Without this row, "the sentence is not on the screen" would pass for a
    // reader that returns nothing at all — the vacuous green every control in
    // this tree exists to rule out.
    const onScreen = readMarkup(`<div><p>${sentenceFor(WORKSPACE)}</p></div>`);
    const foldedAway = readMarkup(`<div aria-hidden="true"><p>${sentenceFor(WORKSPACE)}</p></div>`);

    expect(onScreen.text).toContain(WORKSPACE);
    expect(foldedAway.text).not.toContain(WORKSPACE);
  });

  // ------------------------------------------------------- the sentence itself
  test("the copy home owns the sentence and it carries the interpolation token", () => {
    // The card must not author this, and the token must be the one the card
    // fills — a template renamed on one side only renders its own placeholder
    // at a customer, which is the failure a `toContain` on the filled string
    // alone would not distinguish from a missing sentence.
    expect(ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate).toContain("{workspace}");
    expect(sentenceFor(WORKSPACE)).toContain(WORKSPACE);
    expect(sentenceFor(WORKSPACE)).not.toContain("{workspace}");
  });

  // ------------------------------------------------------------- THE WIRE, ON
  test("a workspace with a name renders the name beside the channel picker", () => {
    const rendered = readCard(WORKSPACE);

    // The founder's own answer to "which workspace did I just connect", in the
    // shipped words rather than in words this suite invented.
    expect(rendered.text).toContain(sentenceFor(WORKSPACE));

    // ...and it is beside the picker rather than instead of it. A sentence that
    // replaced the one control on the card would be a dead end wearing a
    // confirmation.
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);

    // No unfilled token reaches a person.
    expect(rendered.text).not.toContain("{workspace}");
  });

  // ------------------------------------------------------------ THE WIRE, OFF
  test("the pasted-token path has no name and renders nothing rather than an empty hole", () => {
    const rendered = readCard(null);

    // That path is handed a token and a channel and is never told a name. What
    // must NOT happen is the sentence rendering around the absence — "Connected
    // to ." and "Connected to null." are both worse than silence, and both are
    // what a naive render of an absent value produces.
    expect(rendered.text).not.toContain("{workspace}");
    expect(rendered.text).not.toContain("null");
    expect(rendered.text).not.toContain("undefined");
    expect(rendered.text).not.toContain(sentenceFor("").trim());

    // The card is otherwise the same card: the picker is still the thing to do.
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
  });

  // ------------------------------------------------------------- D5, the empty
  test("a stored name that is blank is the same absence as no name at all", () => {
    // Production holds every value ever written, not the value the type
    // declares. A column that came back `""` — a workspace Slack named with
    // whitespace, a legacy row, a write that stored the empty string rather
    // than the null — must take the absent path, not render a headless
    // sentence.
    const blank = readCard("   ");

    expect(blank.text).not.toContain(sentenceFor("").trim());
    expect(blank.text).toContain(ONBOARDING_MESSAGES.channelLabel);

    // ...and the third absence, which the required prop stops a TypeScript
    // caller writing and nothing else. A card that crashed here would take the
    // whole delivery step down for the sake of a sentence it could not render.
    const absent = readCardWithNoSuchProp();

    expect(absent.text).not.toContain(sentenceFor("").trim());
    expect(absent.text).toContain(ONBOARDING_MESSAGES.channelLabel);
  });

  // -------------------------------------------------------------- D11 itself
  test("two different workspaces do not render the same card", () => {
    // The wire, stated as one assertion. A card that never reads the prop —
    // because nobody threaded it, or because the branch was written and then
    // the prop renamed — renders byte-identically whatever it is handed, and
    // every other render row above could still be satisfied by a card that
    // ignores its input. This one cannot.
    expect(readCard(WORKSPACE).text).not.toBe(readCard("Somewhere else entirely").text);
    expect(readCard(WORKSPACE).text).not.toBe(readCard(null).text);
  });

  // ------------------------------------------------------ the other end of it
  test("the server page passes the payload's own field into the card", () => {
    // CONTROLS FIRST. The planted page renders the card with every other Slack
    // fact and this one dropped, which is precisely the state this repository
    // shipped; the clean one threads it.
    expect(offenders([PLANTED_UNTHREADED_PAGE], NAME_THREADED)).toEqual([]);
    expect(offenders([CLEAN_THREADED_PAGE], NAME_THREADED)).not.toEqual([]);

    const page = readFirstRun(FIRST_RUN_PAGE);

    // The attribute is on the real page, fed from the payload — not from a
    // second read of the connection row, and not from anything the client could
    // derive for itself.
    expect(offenders([page], NAME_THREADED)).not.toEqual([]);
    expect(blankComments(page.source)).toContain("slackWorkspaceName");
  });
});
