// THE DEAD END THE FINAL ACTIVATION SWEEP FOUND, AND THE TWO STATES IT PROVED
// MUST NOT COLLAPSE INTO ONE.
//
// ###########################################################################
// # THE STATE: THE LIST LOADS, AND IT COMES BACK WITH NOTHING IN IT.
// #
// # `readChannelList` answers `[]` for a successful listing of an empty
// # workspace and `null` for a listing that did not arrive. The card's original
// # `listUnavailable` covered only the second, so the first fell through to the
// # picker: a `Select` rendered ENABLED with nothing in it, under the sentence
// # "Choose the channel we should post in. Nothing arrives anywhere until you
// # pick one." The primary action was disabled for as long as the founder
// # looked at it, because a choice can never be made from an empty list, and
// # nothing on the screen said why or what to do. The only live control was
// # "Skip for now", which is not an answer to "why is this empty".
// #
// # HOW IT IS REACHED. A workspace where the granted scopes show the bot
// # nothing: every channel private, a workspace made minutes ago, or a bot
// # nobody has invited anywhere yet. Uncommon, not unreachable.
// #
// # WHY IT IS NOT JUST A WIDER `listUnavailable`. The two states have OPPOSITE
// # next actions. A list that did not arrive is ours to fetch again and says
// # so. A list that arrived empty needs somebody to go into Slack and invite
// # the bot before a second fetch can answer differently. One condition for
// # both hands one of them the other's instruction — which is a button the
// # founder presses until they give up, the same failure the card's own header
// # already refuses on the four post failures.
// ###########################################################################
//
// ── WHY THE PICKER IS RENDERED DIRECTLY ─────────────────────────────────────
//
// The list arrives through an effect, and `renderToStaticMarkup` runs no
// effects — so through the parent, `channels` is `null` at first render and the
// empty state is UNREACHABLE. Rendering `ChannelPicker` with the list it would
// have been handed is what makes the state testable at all, and the parent's
// own row below drives the whole card to prove the wire between them is
// attached rather than assumed (D11).
//
// The renderer, the providers and the fake router are the ones
// `oauth-availability-wire.test.ts` established: `react-dom/server` inside
// `MantineProvider` and Next's `AppRouterContext`, reading only what reaches a
// person. Nothing in the harness is patched and no DOM runner is added.
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
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

import {
  ChannelPicker,
  ConnectSlackForm,
  noChannelsVisible,
} from "../../components/first-run/ConnectSlackForm";
import type { SlackChannelChoice } from "../../components/first-run/api";

import {
  blankComments,
  CONNECT_SLACK_FORM,
  fixture,
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

/** The markup itself, for the one question a text reader cannot answer. */
const pickerMarkup = (channels: readonly SlackChannelChoice[] | null): string =>
  render(
    createElement(ChannelPicker, { channels, value: null, onChange: () => {}, disabled: false }),
  );

/**
 * A control rendered by Mantine's `Select`, whatever it wraps it in.
 *
 * The empty state's whole point is that NO PICKER RENDERS, and "the label is
 * not on the screen" would also pass for a picker rendered without its label.
 * The input element is the control itself.
 */
const PICKER_CONTROL = /<input\b/;

const CHANNELS: readonly SlackChannelChoice[] = [
  { id: "C01AB2CD3EF", name: "growth" },
  { id: "C09ZY8XW7VU", name: "engineering" },
];

// ===========================================================================
// The step and the view the whole card is rendered against
// ===========================================================================

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

/**
 * The card in the window AD-4 opens: a workspace attached, no channel chosen.
 * That is the ONLY state the picker renders in, and it is where the dead end
 * was found.
 */
const readPickingCard = (): RenderedCard =>
  readMarkup(
    render(
      createElement(ConnectSlackForm, {
        step: slackStep(),
        view: ACTIVE_VIEW,
        channelId: null,
        slackWorkspaceAttached: true,
        slackOAuthAvailable: true,
      }),
    ),
  );

// ===========================================================================
// The retry's own branch, scanned — with its planted offender and its clean
// fixture, because a scan with neither is a scan nobody can see is vacuous
// ===========================================================================

/**
 * `retry()` re-lists rather than re-posting, on BOTH list states.
 *
 * A retry that fell through to the post branch would send a test message
 * through a channel that was never chosen — and on the empty state there is
 * nothing to send it through at all, so the press would answer with a refusal
 * about the wrong thing entirely.
 */
const RELIST_BRANCH = /if\s*\(\s*relistable\s*\)/;

/** The regression itself: the re-list branch guarded by the failure state alone. */
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

// ###########################################################################
describe("the channel list that arrives empty — the sweep's dead end", () => {
  // ------------------------------------------------------------------ reader
  test("the markup reader sees a rendered picker and does not see a folded-away one", () => {
    // Without this row, "no picker rendered" would pass for a reader that
    // returns nothing at all — the vacuous green every control rules out.
    const onScreen = readMarkup('<div><label>Channel</label><input id="c"/></div>');
    const foldedAway = readMarkup('<div aria-hidden="true"><label>Channel</label></div>');

    expect(onScreen.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(foldedAway.text).not.toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(PICKER_CONTROL.test('<div><label>Channel</label><input id="c"/></div>')).toBe(true);
    expect(PICKER_CONTROL.test("<div><p>nothing to choose from</p></div>")).toBe(false);
  });

  // ------------------------------------------------------- the two facts, apart
  test("a list that arrived empty and a list that has not arrived are different facts", () => {
    // The predicate is the one home for the distinction — the card's retry
    // wiring and the picker's own branch both ask it, and neither may re-derive
    // it. `null` is ours to fetch again; `[]` is an answer about the workspace.
    expect(noChannelsVisible(null)).toBe(false);
    expect(noChannelsVisible([])).toBe(true);
    expect(noChannelsVisible(CHANNELS)).toBe(false);
  });

  // -------------------------------------------------------------- THE DEAD END
  test("an empty channel list renders the sentence instead of an empty picker", () => {
    const rendered = readPicker([]);

    // What happened, and the one next action — which is in Slack, not here.
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);

    // AND NO PICKER. Not a disabled one, not an empty one under its prompt: a
    // control whose only outcome is the one the founder already has is the
    // dead end, and rendering it greyed out says no more than rendering it
    // enabled did.
    expect(PICKER_CONTROL.test(pickerMarkup([]))).toBe(false);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackChannelPickPrompt);
  });

  // ------------------------------------------------- the state next door, intact
  test("a list that has not arrived yet renders the picker and claims nothing about the workspace", () => {
    const rendered = readPicker(null);

    // Telling somebody their workspace has no channels while we are still
    // asking would send them off to invite a bot they have already invited.
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(PICKER_CONTROL.test(pickerMarkup(null))).toBe(true);
  });

  test("a list with channels in it renders the picker and not the sentence", () => {
    const rendered = readPicker(CHANNELS);

    expect(rendered.text).toContain(ONBOARDING_MESSAGES.slackChannelPickPrompt);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);
    expect(PICKER_CONTROL.test(pickerMarkup(CHANNELS))).toBe(true);
  });

  // ----------------------------------------------------------------- the wire
  test("the delivery card hands the picker its real list and keeps the skip in the row", () => {
    const rendered = readPickingCard();

    // D11: the picker could be perfect and never be handed anything. On first
    // render the list has not arrived, so the card must show the picker and say
    // nothing about an empty workspace — a card that rendered the sentence here
    // would be one that ignores what it was given.
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackNoChannelsVisible);

    // Deviation 2, on the state the sweep found: the action row sits OUTSIDE
    // the branch that chooses a card, so a skip cannot go missing when the card
    // changes shape. This is the row that says so from the picking state.
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  // --------------------------------------------------------------- the retry
  test("try again re-lists on both list states rather than re-posting", () => {
    // CONTROLS FIRST.
    expect(offenders([PLANTED_FAILURE_ONLY_RETRY], FAILURE_ONLY_BRANCH)).not.toEqual([]);
    expect(offenders([PLANTED_FAILURE_ONLY_RETRY], RELIST_BRANCH)).toEqual([]);
    expect(offenders([CLEAN_RELIST_RETRY], RELIST_BRANCH)).not.toEqual([]);
    expect(offenders([CLEAN_RELIST_RETRY], FAILURE_ONLY_BRANCH)).toEqual([]);

    const card = readFirstRun(CONNECT_SLACK_FORM);

    // The re-list branch exists and is guarded by the value covering both list
    // states. The founder who has just gone and invited the bot needs a way
    // back to the list that is not the consent trip they already made, and the
    // one already beside them must not fall through to the post.
    expect(offenders([card], RELIST_BRANCH)).not.toEqual([]);
    expect(offenders([card], FAILURE_ONLY_BRANCH)).toEqual([]);

    // ...and the branch is reached from a retry, not from somewhere else.
    expect(blankComments(card.source)).toContain("setListingAttempt");
  });
});
