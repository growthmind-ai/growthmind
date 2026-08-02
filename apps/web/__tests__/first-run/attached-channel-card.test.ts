// CR-3, AND THE SECOND DEAD END THE ONCE-ONLY ATTACH GUARD OPENED BESIDE IT.
//
// ###########################################################################
// # THE STATE: CONSENT COMPLETED, A CHANNEL PICKED, THE ATTACH COMMITTED, AND
// # THE TEST POST FAILED.
// #
// # `sendTo` answered `true` for a 200 carrying a failure outcome, so the
// # channel-local flag was set; `marksStepDone` is false on every failure, so
// # nothing refreshed. The card was then `settled=false`, `workspaceAttached`
// # and `channelAttached` — which is past the picker (a channel is attached)
// # and past the "Add to Slack" fallback (a workspace is attached), and fell
// # through to THE PASTED-TOKEN FORM. A founder who had just finished an OAuth
// # consent screen was shown two inputs asking for a bot token they never had.
// #
// # IT IS NOT EXOTIC. `apps/web/lib/slack/channels.ts` records that picking a
// # public channel the bot has not joined fails with `not_in_channel` ON THE
// # TEST POST, and that maps to `channel_unavailable`, which is not retryable —
// # so there was no Retry button, no picker and no way to re-pick either.
// #
// # THE INVARIANT THIS FILE PINS: the pasted-token form NEVER renders on an
// # organization that already has a workspace attached, by either path.
// ###########################################################################
//
// ── AND THE SECOND ONE, WHICH IS THE SAME CONFLATION READ THE OTHER WAY ─────
//
// `attachChannel` fills an empty address and never moves a chosen one (D12 —
// the delivery ledger's identity is `(organization_id, finding_id, channel_id)`
// and re-pointing forks it), so a second attach matches zero rows and the route
// answers 409 `channel_already_chosen`. The channel route can commit the attach
// and STILL answer a refusal afterwards: no poster to open, or a connection
// dropped on the way back. `sendTo` returned `false` for both, so the flag was
// never set, the picker stayed mounted over an organization that had already
// chosen, and every later press met that 409 forever.
//
// One boolean meant two facts. `channelAddressLanded` is the split, and it is
// exported for its own test because the answer is only reachable through a
// press — the server renderer these suites use dispatches no events.
//
// The renderer, the providers and the fake router are the ones
// `oauth-availability-wire.test.ts` established and `channel-picker-empty.test.ts`
// reused: `react-dom/server` inside `MantineProvider` and Next's
// `AppRouterContext`, reading only what reaches a person through the shared
// markup reader. Nothing in the harness is patched and no DOM runner is added.
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
  channelAddressLanded,
  ConnectSlackForm,
  type SendAnswer,
} from "../../components/first-run/ConnectSlackForm";

import {
  blankComments,
  CONNECT_SLACK_FORM,
  fixture,
  offenders,
  readFirstRun,
} from "./helpers/first-run-source";
import { readMarkup, type RenderedCard } from "./helpers/rendered-markup";

// ===========================================================================
// The tree every render row goes through
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
 * ANY typed field, whatever Mantine wraps it in.
 *
 * "The bot-token label is not on the screen" would also pass for a token field
 * rendered without its label, and the whole point of this state is that NO
 * field renders. The input element is the field itself.
 */
const TYPED_FIELD = /<input\b/;

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

interface CardState {
  readonly channelId: string | null;
  readonly slackWorkspaceAttached: boolean;
  readonly slackWorkspaceName: string | null;
  readonly slackOAuthAvailable: boolean;
}

const cardMarkup = (state: CardState): string =>
  render(createElement(ConnectSlackForm, { step: slackStep(), view: ACTIVE_VIEW, ...state }));

const readCard = (state: CardState): RenderedCard => readMarkup(cardMarkup(state));

/**
 * THE DEAD END, AS PROPS. A workspace attached by consent and a channel already
 * stamped, on a step nothing has settled — which is exactly what the card holds
 * after an attach that committed and a test post that failed.
 */
const ATTACHED_AND_UNSETTLED: CardState = {
  channelId: "C01AB2CD3EF",
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
};

/** The same organization one act earlier: attached, nothing chosen yet. */
const PICKING: CardState = {
  channelId: null,
  slackWorkspaceAttached: true,
  slackWorkspaceName: "Acme",
  slackOAuthAvailable: true,
};

/**
 * The self-hosted card, where the pasted-token form is the primary path and
 * SHOULD render. The control for every "no token fields" claim below — without
 * it, a reader that saw no fields anywhere would report the invariant kept on
 * the day the form went missing from the one card that needs it.
 */
const NOTHING_ATTACHED: CardState = {
  channelId: null,
  slackWorkspaceAttached: false,
  slackWorkspaceName: null,
  slackOAuthAvailable: false,
};

// ===========================================================================
// The wire from the press to the flag, scanned — with its planted offender and
// its clean fixture, because a scan with neither is a scan nobody can see is
// vacuous
// ===========================================================================

/** The split: the flag follows the ADDRESS, asked for by name. */
const LANDED_BRANCH = /if\s*\(\s*channelAddressLanded\(/;

/** The regression itself: one boolean read as both facts, inline on the call. */
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

/** One round trip's answer, defaulted to the shape that changed nothing. */
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

// ###########################################################################
describe("the card after the address is stamped — CR-3's dead end", () => {
  // ------------------------------------------------------------------ reader
  test("the markup reader and the field scan can both see a form that is there", () => {
    // Without this row, every "no token fields" assertion below would pass for
    // a reader that returns nothing at all — the vacuous green every control in
    // this wave exists to rule out.
    const onScreen = readCard(NOTHING_ATTACHED);

    expect(onScreen.text).toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(onScreen.text).toContain(ONBOARDING_MESSAGES.channelIdLabel);
    expect(TYPED_FIELD.test(cardMarkup(NOTHING_ATTACHED))).toBe(true);
    expect(TYPED_FIELD.test("<div><p>nothing to type into</p></div>")).toBe(false);
  });

  // -------------------------------------------------------------- THE DEAD END
  test("an attached workspace with a stamped channel is never shown the pasted-token form", () => {
    const rendered = readCard(ATTACHED_AND_UNSETTLED);

    // THE INVARIANT. A founder who has just completed a consent screen is not
    // asked for a bot token, on this state or any other with a workspace
    // attached — a token they never had, for a connection that already exists,
    // whose second submit lands on the partial unique index.
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelIdLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.channelIdHelper);

    // AND NO FIELD AT ALL, not a disabled one and not a folded one. The picker
    // is gone too: the address is stamped, and `attachChannel` never moves a
    // chosen one, so a control offering to re-pick would post into the 409
    // every time.
    expect(TYPED_FIELD.test(cardMarkup(ATTACHED_AND_UNSETTLED))).toBe(false);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.slackChannelPickPrompt);

    // WHAT IS LEFT IS WHAT CAN WORK. The send button re-posts through the
    // stored channel — the press that succeeds the moment the bot is invited to
    // it — and the skip is still in the row, as it is on every unsettled state
    // (deviation 2: a skip a founder cannot find is not a skip).
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.sendTestMessage);
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  // ------------------------------------------------- the way back, where it works
  test("an attached workspace with no channel yet is still shown the picker", () => {
    const rendered = readCard(PICKING);

    // THE WAY BACK TO PICKING, and it is kept by the flag being narrow rather
    // than by a control: every refusal that leaves the address unstamped leaves
    // the founder here, with the pick still to make. Which is also the row that
    // stops the assertions above being a claim about a card that renders
    // nothing in every state.
    expect(rendered.text).toContain(ONBOARDING_MESSAGES.channelLabel);
    expect(rendered.text).not.toContain(ONBOARDING_MESSAGES.botTokenLabel);
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  // ----------------------------------------- the two facts that were one boolean
  test("the address landing is decided by the attach, never by the post succeeding", () => {
    // A test-post answer means the attach committed and the route went on to
    // post. The address stands whether or not the message arrived — a failed
    // test post never rolls back a correct pick (D8).
    expect(channelAddressLanded(sendAnswer({ posted: true, marksStepDone: true }))).toBe(true);
    expect(channelAddressLanded(sendAnswer({ posted: true }))).toBe(true);

    // The once-only guard reporting the address was already there. The server
    // knows; the client stops arguing with it rather than pressing into a 409
    // forever.
    expect(channelAddressLanded(sendAnswer({ code: "channel_already_chosen" }))).toBe(true);

    // Everything else leaves the address unstamped, and the founder in the
    // picker. A refusal that also matched here would unmount the picker over an
    // organization that has chosen nothing.
    expect(channelAddressLanded(sendAnswer({ code: "channel_not_listed" }))).toBe(false);
    expect(channelAddressLanded(sendAnswer({ code: "no_workspace_connected" }))).toBe(false);
    expect(channelAddressLanded(sendAnswer({ code: "channels_call_failed" }))).toBe(false);
    expect(channelAddressLanded(sendAnswer({}))).toBe(false);
  });

  // ----------------------------------------------------------------- the wire
  test("the channel press asks the address, not the post, and refreshes on it", () => {
    // CONTROLS FIRST.
    expect(offenders([PLANTED_COMBINED_BOOLEAN], COMBINED_BOOLEAN)).not.toEqual([]);
    expect(offenders([PLANTED_COMBINED_BOOLEAN], LANDED_BRANCH)).toEqual([]);
    expect(offenders([CLEAN_SPLIT], LANDED_BRANCH)).not.toEqual([]);
    expect(offenders([CLEAN_SPLIT], COMBINED_BOOLEAN)).toEqual([]);

    const card = readFirstRun(CONNECT_SLACK_FORM);

    // D11: the predicate could be perfect and never be asked. The press reads
    // it by name, and the old combined boolean is gone rather than sitting
    // beside it.
    expect(offenders([card], LANDED_BRANCH)).not.toEqual([]);
    expect(offenders([card], COMBINED_BOOLEAN)).toEqual([]);

    // ...and the answer is acted on: the step is resolved against the server,
    // whose own `slackConnected` derives from the stored channel existing and
    // not from a message having arrived.
    const code = blankComments(card.source);
    expect(code).toContain("setChannelNow(true)");
    expect(code).toContain("router.refresh()");
  });
});
