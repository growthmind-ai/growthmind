// AD-6's WIRE, DRIVEN FROM BOTH ENDS — task 0.7.
//
// ###########################################################################
// # WHY THIS FILE IS NOT A PRODUCER TEST AND NOT A CONSUMER TEST.
// #
// # `slackOAuthAvailable` is computed by the server (`lib/first-run/status.ts`)
// # and branched on by the client (`ConnectSlackForm.tsx`). That is the exact
// # shape D11 names: a value one surface computes for a different surface to
// # read, connected only by a hand-passed field.
// #
// # The failure is silent by construction. A producer test passes — the server
// # computes the boolean. A consumer test passes — the card handles the flag
// # WHEN GIVEN ONE. And in between, nobody threads it: the prop is always
// # absent, the "when true…" branch never runs, and every gate downstream reads
// # the permanent absence as the legitimate "no Slack app configured" case. The
// # OAuth path is then dead code that typechecks, and the only signal is a
// # founder who never sees a button that was built for them.
// #
// # So every render row below drives the SAME component with the flag at BOTH
// # values and asserts the two renders differ in the way AD-6 says they must.
// # A card that ignores the prop renders identically twice, and that is the
// # severed wire, caught.
// ###########################################################################
//
// ── A REAL RENDERER, NOT A FUNCTION CALL ───────────────────────────────────
//
// The delivery card calls `useState` and `useRouter`, so it is NOT a hook-free
// pure component and MUST NOT be invoked as a plain function — that pattern
// produces `Invalid hook call`, and the two ways to "fix" it (globally
// suppressing the error, or monkeypatching React's dispatcher) are both
// forbidden outright: they hollow out every component test in the repository
// while reporting green. See `REVIEW.md` ("Tests": a test that mocks the
// boundary proves your mock's behaviour, not the boundary's) and
// `.agents/skills/writing-a-unit-test/SKILL.md` ("Drive the real entry point").
//
// This file therefore renders through `react-dom/server`, which dispatches
// hooks properly, inside the two providers the card's own tree needs:
// `MantineProvider` for the components and `AppRouterContext` for `useRouter`.
// The router is a FAKE — six no-op methods satisfying `AppRouterInstance` —
// not a mock of anything we wrote. Nothing in the harness is patched; the
// providers are the same ones the running app mounts.
//
// The cost is that effects do not run and clicks cannot be dispatched, so every
// assertion here is about FIRST RENDER — which is precisely what AD-6 is about:
// which card a founder lands on before they touch anything.
//
// ── AND A SOURCE SCAN, BECAUSE A RENDER ONLY PROVES TODAY ──────────────────
//
// "The client never reads env" (AD-6) is a claim about every future edit, not
// about this tree. A render assertion cannot see a `process.env` read that a
// later well-meaning edit adds — reaching for the env var directly is the
// obvious shortcut the moment somebody wants the flag one component deeper. The
// scan is what survives that edit, and like every scanner in this wave it ships
// a PLANTED OFFENDER and a CLEAN FIXTURE, asserted before any claim about real
// source: a scanner that matched nothing would report "the client reads no env"
// forever, including on the day it does.
//
// EVERY RENDER ROW IS RED TODAY. `ConnectSlackForm.tsx` exists and works, but
// it takes no `slackOAuthAvailable` and knows nothing about OAuth — the
// CONTRACT is what is absent, so each row states that first through
// `assertUnderConstruction` and names Wave 6 as its owner. Without that
// precondition the "flag false" row would report GREEN today, because today's
// card happens to be the false-branch card — a green that would mean "the false
// branch is tested" while nothing had tested any branch at all.
//
// THREE ROWS ARE GREEN TODAY, AND THAT IS SAID OUT LOUD RATHER THAN ENGINEERED
// AWAY. The reader's own row is a control: its job is to prove this file can
// tell "on the screen" from "folded away", and it has to pass from the first
// commit or none of the rows above it mean anything. The two env scans assert
// an ABSENCE that is already true and must survive Wave 6 — an absence cannot
// be red before the code that could violate it exists, and forcing a red there
// with a fake precondition would be a lie about what is being tested. What
// stops all three from being vacuous is the planted offender each of them
// asserts on FIRST.
import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType } from "react";
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
  assertUnderConstruction,
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  blankComments,
  CONNECT_SLACK_FORM,
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

const OWNER = "ADD Wave 6, task 6.2 (apps/web/components/first-run/ConnectSlackForm.tsx, AD-6)";

// ===========================================================================
// The contract mirror
//
// Copied from the ADD's own contract block, NOT imported from the component —
// a static import of the real props type would typecheck against today's
// three-prop interface and make the fourth prop unwritable here, which is the
// one thing this file exists to say is missing.
// ===========================================================================

/**
 * What the delivery card takes once AD-6 lands.
 *
 * The first three are today's props, verbatim. `slackOAuthAvailable` is the
 * addition, and the ADD's comment on it is the whole point: *"Decides which
 * delivery card renders. Never read from env by the client."*
 */
interface DeliveryCardProps {
  readonly step: WorkStep;
  readonly view: StepView;
  /** FR-O13: read from the stored row. `null` until a channel is attached. */
  readonly channelId: string | null;
  /** AD-6. Server-computed, hand-passed, and therefore a D11 wire. */
  readonly slackOAuthAvailable: boolean;
}

const loadDeliveryCard = (): Promise<ComponentType<DeliveryCardProps>> =>
  loadValueUnderConstruction<ComponentType<DeliveryCardProps>>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/ConnectSlackForm"),
    exportName: "ConnectSlackForm",
    ownedBy: OWNER,
  });

/**
 * The row's precondition: the prop exists at all.
 *
 * A source scan rather than a runtime check, because a React component's
 * accepted props are erased at runtime — passing an unknown prop to today's
 * card is silently ignored, which is exactly the severed-wire symptom and would
 * otherwise surface as a passing test.
 */
function deliveryCardTakesTheFlag(): void {
  const source = blankComments(readFirstRun(CONNECT_SLACK_FORM).source);

  assertUnderConstruction(/\bslackOAuthAvailable\b/.test(source), {
    contract:
      "the delivery card takes `slackOAuthAvailable` and branches on it — today it takes " +
      "`step`, `view` and `channelId` only, so the flag is a wire with one end unattached (AD-6, D11)",
    ownedBy: OWNER,
  });
}

// ===========================================================================
// The step and the view the card is rendered against
// ===========================================================================

/**
 * The SHIPPED descriptor, not a hand-written one.
 *
 * Every field label asserted below comes off this, so the rows say "each field
 * this step carries is visible / is folded away" rather than pinning copy this
 * suite would be inventing on the copy home's behalf (FR-O22).
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

/** Step 3, open and accepting input — the state a founder first meets it in. */
const ACTIVE_VIEW: StepView = {
  id: "slack",
  ordinal: 3,
  state: "active",
  open: true,
  interactive: true,
};

/**
 * The router the card's `useRouter()` resolves to.
 *
 * A FAKE, not a mock: six real no-op methods handed through Next's own context,
 * which is the same mechanism the running app uses. Nothing is patched and no
 * module is intercepted, so this file cannot leak a stubbed `next/navigation`
 * into any other suite in the process.
 */
const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

// ===========================================================================
// Reading the rendered card the way a founder does
//
// The reader lives in `./helpers/rendered-markup` because a second suite — the
// channel picker's empty state — turns on the same distinction, and two private
// copies of a markup walker drift the first time one of them learns about a new
// way to hide something. Its own header states what "hidden" means here. What
// stays in this file is the CONTROL row below, which proves the reader can tell
// "on the screen" from "folded away" before any row claims either about a real
// render.
// ===========================================================================

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
          createElement(Card, {
            step: slackStep(),
            view: ACTIVE_VIEW,
            channelId: null,
            slackOAuthAvailable,
          }),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// The reader's own controls
//
// Without these, "the token form is not on the screen" passes for a reader that
// returns nothing at all — the vacuous green every control in this wave exists
// to rule out.
// ---------------------------------------------------------------------------

/** A card with the token form in plain sight. Everything must be readable. */
const MARKUP_ON_SCREEN =
  "<div><style>.x{display:none}</style>" +
  '<label for="t">Bot token</label><input id="t"/>' +
  '<button type="button"><span><span>Send a test message</span></span></button></div>';

/**
 * The same words, folded away three different ways — a collapsed Mantine
 * region, a closed `<details>`, and an `aria-hidden` block. All three are the
 * shape "behind a disclosure" can legitimately take, and the reader must give
 * the same answer for each while still seeing the control that opens them.
 */
const MARKUP_FOLDED_AWAY =
  '<div><button type="button"><span>Add to Slack</span></button>' +
  '<div style="height:0;overflow:hidden;display:none" aria-hidden="true" inert="">' +
  '<label for="t">Bot token</label></div>' +
  "<details><summary>No Slack app?</summary><label>Bot token</label></details>" +
  '<div aria-hidden="true"><span>Send a test message</span></div></div>';

// ===========================================================================
// The env scanners, each with its planted offender and its clean fixture
// ===========================================================================

interface Ban {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * The shortcut AD-6 forbids. Reading the variable in the client is not merely a
 * second source of truth — `SLACK_CLIENT_ID` is a SERVER variable, so
 * `process.env.SLACK_CLIENT_ID` in a `"use client"` component is `undefined` in
 * the browser and the card silently renders the false branch for everybody,
 * including the workspaces that DO have a Slack app configured.
 */
const CLIENT_ENV_BANS: readonly Ban[] = [
  { name: "process.env", pattern: /process\s*\.\s*env\b/ },
  { name: "a NEXT_PUBLIC_ variable", pattern: /\bNEXT_PUBLIC_[A-Z0-9_]+/ },
  { name: "the Slack app credentials", pattern: /\bSLACK_CLIENT_(?:ID|SECRET)\b/ },
];

const envReadsIn = (files: readonly ScannedFile[]): readonly string[] =>
  CLIENT_ENV_BANS.flatMap(({ pattern }) => offenders(files, pattern));

/**
 * The other way the same wire gets bypassed: publish the client id to the
 * bundle under a `NEXT_PUBLIC_` name and the client can branch on env after
 * all. AD-6 makes both variables `.optional()` SERVER env; a public twin is
 * always wrong, so this needs no exemption for the server files that legitimately
 * read the private names.
 */
const publishedSlackCredentials = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(files, /\bNEXT_PUBLIC_SLACK[A-Z0-9_]*/);

/** What a well-meaning contributor writes when the flag has not been threaded. */
const PLANTED_ENV_CLIENT = fixture(
  "PlantedEnvClient",
  `"use client";
import { Button } from "@mantine/core";

export function ConnectSlackForm() {
  // Reaching for the variable directly, one component deep.
  const available = process.env.SLACK_CLIENT_ID !== undefined;
  const publicId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;

  return available ? <Button>Add to Slack</Button> : <Button>{publicId}</Button>;
}
`,
);

/** The same decision taken from the payload, which is where AD-6 puts it. */
const CLEAN_ENV_CLIENT = fixture(
  "CleanEnvClient",
  `"use client";
import { Button } from "@mantine/core";

export function ConnectSlackForm({ slackOAuthAvailable }: { slackOAuthAvailable: boolean }) {
  return slackOAuthAvailable ? <Button>Add to Slack</Button> : <Button>Send a test message</Button>;
}
`,
);

/** A server file publishing the client id to the bundle. */
const PLANTED_PUBLIC_CREDENTIAL = fixtureAt(
  "apps/web/lib/slack/planted-oauth.ts",
  `export const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID ?? "";\n`,
);

/** The same file reading the private, server-only name. */
const CLEAN_PRIVATE_CREDENTIAL = fixtureAt(
  "apps/web/lib/slack/clean-oauth.ts",
  `import { env } from "@growthmind/shared";\n\nexport const clientId = env.SLACK_CLIENT_ID;\n`,
);

/** Whichever way "Add to Slack" ends up worded, it is the OAuth control. */
const ADD_TO_SLACK = /\badd\b[\s\S]{0,32}?\bto slack\b/i;

const named = (controls: readonly string[], pattern: RegExp): readonly string[] =>
  controls.filter((label) => pattern.test(label));

// ###########################################################################
describe("AD-6's delivery-card wire — slackOAuthAvailable, driven from both ends", () => {
  // ------------------------------------------------------------------ reader
  test("the markup reader separates what is on the screen from what is folded away", () => {
    const onScreen = readMarkup(MARKUP_ON_SCREEN);
    const foldedAway = readMarkup(MARKUP_FOLDED_AWAY);

    // It reads real words, so an empty answer can never be mistaken for "the
    // forbidden thing is absent".
    expect(onScreen.text).toContain("Bot token");
    expect(onScreen.controls).toContain("Send a test message");

    // ...and it does not read a stylesheet as copy.
    expect(onScreen.text).not.toContain("display:none");

    // All three folds give the same answer, and the control that opens them is
    // still visible — a disclosure a founder cannot see is not a disclosure.
    expect(foldedAway.text).not.toContain("Bot token");
    expect(foldedAway.text).not.toContain("Send a test message");
    expect(foldedAway.controls).toContain("No Slack app?");
    expect(named(foldedAway.controls, ADD_TO_SLACK)).not.toEqual([]);
  });

  // ------------------------------------------------- AD-6, the false branch
  test("with no Slack app configured the pasted-token form is the card, not a fallback", async () => {
    deliveryCardTakesTheFlag();

    // CONTROL: the reader sees a form that is on the screen.
    expect(readMarkup(MARKUP_ON_SCREEN).text).toContain("Bot token");

    const Card = await loadDeliveryCard();
    const rendered = renderDeliveryCard(Card, false);
    const step = slackStep();

    // SELF-HOST IS FIRST-CLASS (AGENTS.md: "every feature must work under
    // `docker compose up` with no external SaaS dependency"). With no Slack app
    // there is nothing to disclose and nothing to press first: every field the
    // step carries is on the screen at first render, and so is the action that
    // submits them.
    for (const field of step.fields) {
      expect(rendered.text).toContain(field.label);
    }
    expect(rendered.controls).toContain(ONBOARDING_MESSAGES.sendTestMessage);

    // And the OAuth path does not render AT ALL — not disabled, not greyed,
    // not "connect your workspace (unavailable)". A control that cannot work is
    // a button a founder presses until they give up.
    expect(named(rendered.controls, ADD_TO_SLACK)).toEqual([]);
  });

  // -------------------------------------------------- AD-6, the true branch
  test("with a Slack app configured the card offers Add to Slack and folds the token form away", async () => {
    deliveryCardTakesTheFlag();

    // CONTROL: the reader reports a folded field as absent from the screen,
    // rather than reporting everything as absent.
    expect(readMarkup(MARKUP_FOLDED_AWAY).text).not.toContain("Bot token");
    expect(readMarkup(MARKUP_ON_SCREEN).text).toContain("Bot token");

    const Card = await loadDeliveryCard();
    const rendered = renderDeliveryCard(Card, true);
    const step = slackStep();

    expect(named(rendered.controls, ADD_TO_SLACK)).not.toEqual([]);

    // The token form is BEHIND something, not gone and not beside it. No id is
    // ever typed on this path either — the channel arrives from the picker.
    for (const field of step.fields) {
      expect(rendered.text).not.toContain(field.label);
    }

    // ...and there is still a way through for a self-hoster whose workspace has
    // no Slack app: a third visible control, which is the fallback disclosure.
    // Without this row, "folded away" would be satisfied by deleting the
    // pasted-token path outright, which is the same product regression wearing
    // a passing test.
    const disclosures = rendered.controls.filter(
      (label) => !ADD_TO_SLACK.test(label) && label !== ONBOARDING_MESSAGES.skipForNow,
    );

    expect(disclosures).not.toEqual([]);
  });

  // ------------------------------------------------------------ deviation 2
  test("skip for now is in the row on both delivery paths", async () => {
    deliveryCardTakesTheFlag();

    const Card = await loadDeliveryCard();

    // A skip a founder cannot find is not a skip, and the branch that decides
    // which delivery card renders is not allowed to decide that too. Both
    // renders, because the OAuth branch is a whole second card and a secondary
    // action is exactly what gets dropped when a card is rewritten.
    expect(renderDeliveryCard(Card, false).controls).toContain(ONBOARDING_MESSAGES.skipForNow);
    expect(renderDeliveryCard(Card, true).controls).toContain(ONBOARDING_MESSAGES.skipForNow);
  });

  // ------------------------------------------------------------- D11 itself
  test("the two values of the flag do not render the same card", async () => {
    deliveryCardTakesTheFlag();

    const Card = await loadDeliveryCard();

    // The wire, stated as one assertion. A card that never reads the prop —
    // because nobody threaded it, or because the branch was written and then
    // the prop was renamed — renders byte-identically for both values, and
    // every other row in this file could still be made to pass by a card that
    // ignores its input. This one cannot.
    expect(renderDeliveryCard(Card, true).text).not.toBe(renderDeliveryCard(Card, false).text);
  });

  // ------------------------------------------ AD-6, "the client never reads env"
  test("no first-run client component reads process.env", () => {
    // CONTROLS. The planted component takes the shortcut; the clean one takes
    // the flag off the payload, which is where AD-6 puts the decision.
    expect(envReadsIn([PLANTED_ENV_CLIENT])).not.toEqual([]);
    expect(envReadsIn([CLEAN_ENV_CLIENT])).toEqual([]);

    // ...and the scan reads CODE, not comments. Task 6.2's own header will say
    // "never process.env", and a rule that failed on the sentence explaining it
    // is a rule nobody can document.
    expect(
      envReadsIn([fixture("Comment", "// the flag comes from the payload, never process.env\n")]),
    ).toEqual([]);

    expect(envReadsIn(readAll(FIRST_RUN_COMPONENTS))).toEqual([]);
  });

  test("no Slack app credential is published to the browser bundle", () => {
    // CONTROLS.
    expect(publishedSlackCredentials([PLANTED_PUBLIC_CREDENTIAL])).not.toEqual([]);
    expect(publishedSlackCredentials([CLEAN_PRIVATE_CREDENTIAL])).toEqual([]);

    // The private names are NOT banned here — Wave 4's OAuth module reads them
    // server-side and must be free to. A `NEXT_PUBLIC_` twin is the one that is
    // always wrong, so this row needs no exemption list to maintain.
    expect(publishedSlackCredentials(webSources())).toEqual([]);
  });
});
