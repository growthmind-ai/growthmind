// THE SHARED STUB CONTRACT, MADE STRUCTURAL — task 0g.1. ADD §9, 5 rows plus
// one orphan checklist row (UX row 30) = 6.
//
// FR-O3 / FR-O15 / AC-O3 / AC-O15, and the PRD's rulings R3 (step 1) and R5
// (step 4). Both stubs are governed by ONE contract, stated once in the PRD's
// `THE SHARED STUB CONTRACT` block and pointed at by both rulings.
//
// ###########################################################################
// # THE PROMISE THIS FILE ENFORCES, IN THE PRD'S OWN WORDS
// #
// # Point 6: "Renders NOTHING that could be mistaken for a live control.
// # Specifically, across both stubs: no repo list, no OAuth button, no install
// # command, no URL, no protocol version, no 'test connection' / 'verify'
// # affordance, and NO FAKE SUCCESS. Nothing unbuilt is clickable."
// #
// # Point 8: "`mvp.md:48` — if any step takes more than a couple of minutes,
// # that step is a bug. A STUB THAT LOOKS LIVE IS WORSE THAN AN HONEST 'NOT
// # YET' — the user tries it and it fails. But a stub that reads as broken is
// # its own failure."
// #
// # Those two sentences are the whole sprint's honesty position, and they are
// # unenforceable as prose. A well-meaning later edit adding a disabled connect
// # field to step 1 — to "show what's coming" — breaks both, breaks no type,
// # and would ship. These six rows are what make it fail instead.
// ###########################################################################
//
// WHY A SOURCE SCAN AND NOT A RENDER TEST (AD-1). There is no DOM test runner
// in this repository and this sprint does not build one (ESC-O1). That is not
// a downgrade here: a render test proves today's tree renders no button; a
// source scan proves it FOR EVERY FUTURE EDIT, which is precisely the failure
// mode the PRD names ("so a later well-meaning edit cannot quietly add one").
//
// EVERY SCANNER SHIPS BOTH CONTROLS (ADD §9 standing rule 1), asserted BEFORE
// any claim about real source. A scanner that matched nothing would report
// green forever, which on this file would mean reporting that a stub is honest
// because the scanner could not read it.
//
// TWO SUBJECTS, ONE RENDERER. AD-19 gives the `coming-next` arm no `fields`,
// no `actions` and no `confirmations` — so BOTH stubs are rendered by the one
// `StubStep.tsx`, and a scan of that file is a scan of both. The descriptors
// carry the copy; the renderer carries the markup; the rows below read both,
// because a clean renderer fed a descriptor whose text names an install command
// still puts an install command on the screen.
//
// EVERY ROW IS RED TODAY. `apps/web/components/first-run/StubStep.tsx` and
// `packages/shared/src/onboarding/steps.ts` are Wave 7a's and Wave 1's. The
// loader and the reader turn that into a NAMED diagnostic that states the
// absent behaviour and its owner, never a bare TS2307 or ENOENT.
import { describe, expect, test } from "bun:test";

import {
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import type { StepDescriptor } from "../../../../packages/shared/__tests__/onboarding/contract-shapes";
import {
  blankComments,
  fixture,
  FIRST_RUN_CSS,
  FIRST_RUN_TREE,
  offenders,
  readAll,
  readExisting,
  readFirstRun,
  STUB_STEP,
  type ScannedFile,
} from "./helpers/first-run-source";

const OWNER_DESCRIPTORS = "ADD Wave 1a, task 1a.3 (packages/shared/src/onboarding/steps.ts, AD-19)";

const loadDescriptors = (): Promise<readonly StepDescriptor[]> =>
  loadValueUnderConstruction<readonly StepDescriptor[]>({
    modulePath: underConstructionSpecifier("packages/shared/src/onboarding/steps"),
    exportName: "STEP_DESCRIPTORS",
    ownedBy: OWNER_DESCRIPTORS,
  });

// ===========================================================================
// Picking a stub out of the sequence
// ===========================================================================

/**
 * The `coming-next` descriptor at a given ordinal, or a named failure.
 *
 * PRESENT AND CORRECTLY ORDERED IS A PRECONDITION OF EVERY ROW BELOW, not a
 * row of its own — `steps.test.ts`'s "each step occupies its own ordinal with
 * a stable identity" owns that claim (task 0c.1) and duplicating it here would
 * put the sequence's ordering in two homes. What this does is make the rows
 * below say WHICH stub they are about, so a failure names step 1 or step 4
 * rather than "a descriptor".
 */
function stubAt(
  descriptors: readonly StepDescriptor[],
  id: string,
  ordinal: number,
): Extract<StepDescriptor, { kind: "coming-next" }> {
  const found = descriptors.find((descriptor) => descriptor.id === id);

  if (found === undefined) {
    throw new Error(
      `NOT IMPLEMENTED YET: STEP_DESCRIPTORS carries no step \`${id}\`. The shared stub contract's ` +
        `point 1 is that a stub HOLDS ITS PLACE in the sequence at its correct ordinal — a missing ` +
        `stub is a renumbered sequence. ${OWNER_DESCRIPTORS} owns it.`,
    );
  }

  if (found.kind !== "coming-next") {
    throw new Error(
      `Step \`${id}\` is \`${found.kind}\`, not \`coming-next\`. Rulings R3 and R5 ship steps 1 and 4 ` +
        `as stubs this sprint; the shared stub contract's point 3 requires the \`coming-next\` state, ` +
        `which is a first-class member of the one step-state union so filling a stub later widens no ` +
        `union (FR-O23).`,
    );
  }

  expect(found.ordinal).toBe(ordinal);
  return found;
}

/** Every customer-visible string a `coming-next` descriptor carries. */
const stubCopy = (stub: Extract<StepDescriptor, { kind: "coming-next" }>): string =>
  [stub.title, stub.whatItWillDo, stub.filler].join("\n");

// ===========================================================================
// The scanners, each with its planted offender and its clean fixture
// ===========================================================================

/** One forbidden construct, named the way a failure should read. */
interface Ban {
  readonly name: string;
  readonly pattern: RegExp;
}

const found = (bans: readonly Ban[], text: string): readonly string[] =>
  bans.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);

/**
 * ROW 1's ban list, verbatim from ADD §9: no `Button`, `TextInput`,
 * `PasswordInput`, `Anchor`, `href`, `onClick`, `tabIndex`, `role="button"`, or
 * `Tooltip`.
 *
 * `Tooltip` is on the list and it is the subtle one: the UX spec names "a
 * `Tooltip` explaining why it is disabled" as a FAILURE, not a mitigation. A
 * tooltip is a hover affordance on an inert element — a cue the user acts on,
 * which is the lie the whole stub treatment exists to refuse.
 */
const CLICKABLE_BANS: readonly Ban[] = [
  { name: "Button", pattern: /\bButton\b/ },
  { name: "TextInput", pattern: /\bTextInput\b/ },
  { name: "PasswordInput", pattern: /\bPasswordInput\b/ },
  { name: "Anchor", pattern: /\bAnchor\b/ },
  { name: "href", pattern: /\bhref\b/ },
  { name: "onClick", pattern: /\bonClick\b/ },
  { name: "tabIndex", pattern: /\btabIndex\b/ },
  { name: 'role="button"', pattern: /\brole\s*=\s*\{?\s*["']button["']/ },
  { name: "Tooltip", pattern: /\bTooltip\b/ },
  { name: "a raw <button>", pattern: /<button\b/ },
  { name: "a raw <a>", pattern: /<a\s/ },
];

const clickableIn = (source: string): readonly string[] =>
  found(CLICKABLE_BANS, blankComments(source));

/**
 * ROW 4's ban list. **The absence of a surface is the signal** (UX §3): "a stub
 * is not a disabled card — it is a row with NO CARD AT ALL". A disabled button,
 * a greyed field, a "coming soon" pill and a tooltip explaining the disablement
 * all fail FR-O3/FR-O15, and all four fail the read-aloud test.
 *
 * `coming soon` is banned; `coming-next` is the STATE and is not — the hyphen
 * is load-bearing and the patterns keep them apart on purpose.
 */
const DISABLED_CARD_BANS: readonly Ban[] = [
  { name: "Paper", pattern: /\bPaper\b/ },
  { name: "Card", pattern: /\bCard\b/ },
  { name: "withBorder", pattern: /\bwithBorder\b/ },
  { name: "disabled", pattern: /\bdisabled\b/i },
  { name: 'a "coming soon" pill', pattern: /coming\s+soon/i },
  { name: "Badge", pattern: /\bBadge\b/ },
];

const disabledCardIn = (source: string): readonly string[] =>
  found(DISABLED_CARD_BANS, blankComments(source));

/**
 * ROW 5 / ROW 6's focusability ban. A tab stop is anything the browser will
 * land on: a control, a link, an explicit `tabIndex`, or a focus handler on an
 * element that would otherwise be inert.
 */
const FOCUSABLE_BANS: readonly Ban[] = [
  ...CLICKABLE_BANS,
  { name: "onFocus", pattern: /\bonFocus\b/ },
  { name: "onKeyDown", pattern: /\bonKeyDown\b/ },
  { name: "contentEditable", pattern: /\bcontentEditable\b/ },
  { name: "autoFocus", pattern: /\bautoFocus\b/ },
];

const focusableIn = (source: string): readonly string[] =>
  found(FOCUSABLE_BANS, blankComments(source));

/** Step 1's out-of-scope surface, enumerated from the PRD's own block. */
const STEP_ONE_BANS: readonly Ban[] = [
  { name: "an OAuth button", pattern: /\boauth\b/i },
  { name: "an authorise-the-app affordance", pattern: /\bauthori[sz]e\b/i },
  {
    name: "the PAT-vs-GitHub-App credential decision",
    pattern: /\bpersonal access token\b|\bgithub app\b|\bPAT\b/i,
  },
  {
    name: "a repo list or picker",
    pattern: /\b(pick|choose|select|browse)\s+(a|your|the)?\s*repos?/i,
  },
  { name: "the reserved slot's future confirmation", pattern: /\bdefault branch\b/i },
  { name: "a connect field", pattern: /\bplaceholder\b|\bTextInput\b|\bPasswordInput\b/ },
  { name: "a fake success", pattern: /\bconnected\b|✓/i },
];

/**
 * Step 4's out-of-scope surface, enumerated from the PRD's own block.
 *
 * **R5 IS THE REASON THIS ROW IS NOT NEGOTIABLE.** O-013 pins the protocol era,
 * the handshake and therefore the exact install string; at the time this sprint
 * ships it is an open PR whose own probe returned `-32601` for `server/discover`
 * and whose stock client negotiates a legacy revision. A wrong install command
 * is worse than an honest stub: the user runs it, it fails, and the product has
 * lied at the exact moment it was asking to be trusted.
 */
const STEP_FOUR_BANS: readonly Ban[] = [
  {
    name: "an install command",
    pattern: /\bclaude\s+mcp\b|\bnpx\b|\bbunx\b|\bnpm\s+i(nstall)?\b/i,
  },
  { name: "a URL or scheme", pattern: /\bhttps?\b/i },
  { name: "a protocol revision or era", pattern: /\b20\d{2}-\d{2}-\d{2}\b/ },
  {
    name: "a verify / test-connection affordance",
    pattern: /\bverify\b|\btest\s+(the\s+)?connection\b|\bcheck\s+the\s+install\b/i,
  },
  { name: "an empty-but-valid handshake claim", pattern: /list_open_fixes|empty[- ]but[- ]valid/i },
  { name: "a fake success", pattern: /\bconnected\b|✓/i },
];

// ---------------------------------------------------------------------------
// The controls
// ---------------------------------------------------------------------------

/**
 * THE OFFENDER IS THE REALISTIC EDIT, NOT AN ABSURD ONE. This is what a
 * well-meaning contributor writes when asked to "show the user what's coming":
 * a bordered card, a disabled button, a tooltip explaining the disablement, and
 * a field they cannot type into. Every single one of those reads to a first-time
 * user as "this is broken", which is failure mode 8 of the stub contract.
 */
const PLANTED_STUB = fixture(
  "PlantedStubStep",
  `"use client";
import { Badge, Button, Paper, PasswordInput, Text, Tooltip } from "@mantine/core";

export function StubStep({ ordinal }: { ordinal: number }) {
  return (
    <Paper withBorder radius="sm" p="md">
      <Text>{ordinal} Connect your code</Text>
      <Badge>Coming soon</Badge>
      <PasswordInput label="GitHub personal access token" placeholder="ghp_..." disabled />
      <Text>Choose a repo and we will show its default branch.</Text>
      <Text>Then run: claude mcp add growthmind https://example.test/api/mcp (2025-11-25)</Text>
      <Tooltip label="Not built yet">
        <Button disabled onClick={() => {}} tabIndex={0}>Verify install</Button>
      </Tooltip>
    </Paper>
  );
}
`,
);

/**
 * The same component built to the contract: ordinal column, two dimmed
 * sentences, no card, no control, nothing focusable. Every string comes off the
 * descriptor, so the renderer authors none of them (FR-O22).
 */
const CLEAN_STUB = fixture(
  "CleanStubStep",
  `import { Box, Group, Text } from "@mantine/core";

import type { ComingNextStep } from "@growthmind/shared";

import styles from "./first-run.module.css";

export function StubStep({ step }: { step: ComingNextStep }) {
  return (
    <Box className={styles.stubRow}>
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <Text c="dimmed" fw={700} className={styles.ordinal} aria-hidden>
          {step.ordinal}
        </Text>
        <Box>
          <Text c="dimmed">{step.title}</Text>
          <Text c="dimmed">{step.whatItWillDo}</Text>
          <Text c="dimmed">{step.filler}</Text>
        </Box>
      </Group>
    </Box>
  );
}
`,
);

/**
 * A SEPARATE offender for the tab-order leg, because the two failures are
 * genuinely different edits.
 *
 * `PLANTED_STUB` carries `tabIndex={0}` — the edit that makes an inert row a
 * tab stop, which leg 2 catches. This one carries a POSITIVE index, which is
 * the edit that reorders the whole page: a positive `tabIndex` jumps its
 * element ahead of every `0` on the document, so "Start watching" is reached
 * before the fields that have to be filled in first, and every keyboard user
 * meets the sequence in an order nobody designed.
 */
const PLANTED_TAB_ORDER = fixture(
  "PlantedTabOrder",
  `export function Sequence() {
  return (
    <form>
      <TextInput label="Project number" />
      <Button type="submit" tabIndex={2}>Start watching</Button>
    </form>
  );
}
`,
);

/** A stylesheet that gives the inert row a hover cue — a lie the user acts on. */
const PLANTED_STUB_HOVER = fixture(
  "planted.module.css",
  `.stubRow { opacity: 0.7; }
@media (hover: hover) {
  .stubRow:hover { opacity: 1; cursor: pointer; }
}
.stepRow:focus-visible { outline: none; }
`,
);

/** The same stylesheet with the stub left alone and the global ring intact. */
const CLEAN_STUB_HOVER = fixture(
  "clean.module.css",
  `.stubRow { opacity: 0.7; }
@media (hover: hover) {
  .stepRow:hover { border-color: var(--mantine-color-default-border); }
}
`,
);

/**
 * A hover rule that targets a stub class, or a pointer cue on one.
 *
 * Selector-scoped rather than a bare `:hover` search, because the stylesheet is
 * shared with the LIVE steps, which legitimately have hover states.
 */
const stubHoverRules = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(
    files,
    /\.[\w-]*stub[\w-]*[^{}]*:hover|:hover[^{}]*\.[\w-]*stub[\w-]*|\.[\w-]*stub[\w-]*[^{}]*\{[^}]*cursor\s*:\s*pointer/i,
  );

/** A `tabIndex` above zero — the only way to depart from DOM tab order. */
const positiveTabIndex = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(files, /tabIndex\s*=\s*\{?\s*["']?[1-9]/);

/** A rule that removes the focus ring the global `:focus-visible` provides. */
const suppressedFocusRing = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(files, /outline\s*:\s*(none|0)\b/i);

// ###########################################################################
describe("the shared stub contract — FR-O3, FR-O15, rulings R3 and R5", () => {
  // -------------------------------------------------------------- §9 row 1
  test("neither stub renders a clickable control", () => {
    // BOTH CONTROLS FIRST. A scanner that matched nothing would report this
    // sprint's honesty promise as kept because it could not read the file.
    expect(clickableIn(PLANTED_STUB.source)).toContain("Button");
    expect(clickableIn(PLANTED_STUB.source)).toContain("Tooltip");
    expect(clickableIn(PLANTED_STUB.source)).toContain("tabIndex");
    expect(clickableIn(CLEAN_STUB.source)).toEqual([]);

    // ...and the scanner reads CODE, not comments. A header on the real file
    // explaining "renders no Button" must not fail the rule it explains.
    expect(clickableIn(`// this component renders no Button and no onClick\n`)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);

    expect(clickableIn(stub.source)).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 2
  // Covers First-Run Checklist row 3.
  test("the step one stub renders no repo list, no oauth button and no connect field", async () => {
    // CONTROLS. The planted component carries step 1's whole out-of-scope
    // surface; the clean one carries none of it.
    expect(found(STEP_ONE_BANS, PLANTED_STUB.source)).not.toEqual([]);
    expect(found(STEP_ONE_BANS, CLEAN_STUB.source)).toEqual([]);

    const descriptors = await loadDescriptors();
    const stepOne = stubAt(descriptors, "repo", 1);

    // THE DESCRIPTOR'S STRINGS. The renderer can be spotless and still put an
    // OAuth button on the screen if the copy describes one as available.
    expect(found(STEP_ONE_BANS, stubCopy(stepOne))).toEqual([]);

    // THE NORMATIVE COPY, VERBATIM. UX First-Run Checklist row 3 states both
    // sentences in bold, and bold is normative — "ship it verbatim or escalate
    // to me". The first says what the real step will do and bounds it
    // ("nothing more"); the second says plainly that it is not built and names
    // its filler. Together they are the whole answer to the PRD's anticipated
    // question "Why do you need my repo? Are you going to write to it?".
    expect(stepOne.whatItWillDo).toBe(
      "When this is built, Growthmind will read your code — nothing more — so it can point " +
        "at the right file when it suggests a fix.",
    );
    expect(stepOne.filler).toBe("Not built yet. It arrives with the fix-spec work.");

    // AND THE RENDERER'S SOURCE. Both halves, because the row is about what
    // reaches the screen and either half alone can put it there.
    const stub = readFirstRun(STUB_STEP);

    expect(found(STEP_ONE_BANS, blankComments(stub.source))).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 3
  test("the step four stub renders no install command, no url, no protocol version and no verify affordance", async () => {
    // CONTROLS.
    expect(found(STEP_FOUR_BANS, PLANTED_STUB.source)).toContain("an install command");
    expect(found(STEP_FOUR_BANS, PLANTED_STUB.source)).toContain("a protocol revision or era");
    expect(found(STEP_FOUR_BANS, CLEAN_STUB.source)).toEqual([]);

    const descriptors = await loadDescriptors();
    const stepFour = stubAt(descriptors, "agent", 4);

    // THE COPY MAY SAY WHAT THE STEP WILL DO. It may not say HOW, because
    // "how" is the one thing this sprint does not know: O-013 pins the era and
    // the handshake, and it is still an open PR whose stock client negotiates
    // a legacy revision. Guessing here is not a small inaccuracy — the user
    // runs the command, it fails, and the honest stub would have been better.
    expect(found(STEP_FOUR_BANS, stubCopy(stepFour))).toEqual([]);

    // The stub still has to name what it is waiting on (contract point 5), so
    // the absence above is honesty rather than emptiness.
    expect(stepFour.filler.trim().length).toBeGreaterThan(0);
    expect(stepFour.whatItWillDo.trim().length).toBeGreaterThan(0);

    const stub = readFirstRun(STUB_STEP);

    expect(found(STEP_FOUR_BANS, blankComments(stub.source))).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 4
  test("no stub row is a disabled card", () => {
    // CONTROLS.
    expect(disabledCardIn(PLANTED_STUB.source)).toContain("Paper");
    expect(disabledCardIn(PLANTED_STUB.source)).toContain("disabled");
    expect(disabledCardIn(PLANTED_STUB.source)).toContain('a "coming soon" pill');
    expect(disabledCardIn(CLEAN_STUB.source)).toEqual([]);

    // `coming-next` is the STATE and must survive the "coming soon" ban — the
    // hyphen is the whole difference and a ban that ate both would force the
    // renderer to stop naming the state it renders.
    expect(disabledCardIn(`const state = "coming-next";`)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);

    // A live step is a card; a stub is a note in the margin of the sequence.
    expect(disabledCardIn(stub.source)).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 5
  test("neither stub has a hover state or a focus stop", () => {
    // CONTROLS, both halves — the stylesheet and the renderer.
    expect(stubHoverRules([PLANTED_STUB_HOVER])).not.toEqual([]);
    expect(stubHoverRules([CLEAN_STUB_HOVER])).toEqual([]);
    expect(focusableIn(PLANTED_STUB.source)).not.toEqual([]);
    expect(focusableIn(CLEAN_STUB.source)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);
    const css = readFirstRun(FIRST_RUN_CSS);

    // "Stub rows and the wait log have no hover state at all. Nothing in them
    // is interactive, and A HOVER CUE ON AN INERT ELEMENT IS A LIE THE USER
    // ACTS ON." (UX §5, binding.)
    expect(stubHoverRules([css])).toEqual([]);
    expect(focusableIn(stub.source)).toEqual([]);
  });

  // ------------------------------------------- ORPHAN: UX checklist row 30
  //
  // THIS ROW HAS NO §9 IDENTIFIER. Taskgen routed six checklist rows to
  // identifiers absent from the ADD's 208; five went to task 0c and this one is
  // 0g.1's. The ADD's own First-Run Checklist mapping table names the test
  // (`tab order is DOM order and neither stub is a tab stop`) and this file,
  // and UX row 30's Expected-UI column states the assertion in full — so the
  // assertion below is taken from that column verbatim rather than invented.
  //
  // The row's live half ("complete the whole sequence with the keyboard only")
  // is `integration-tester`'s, exactly as the mapping table marks it. What is
  // automatable is the STRUCTURAL half, and it is the half that decays: DOM
  // order is the default and stays correct until somebody reaches for a
  // positive `tabIndex`, at which point the order silently diverges from the
  // reading order for every keyboard user and nothing else notices.
  test("tab order is DOM order and neither stub is a tab stop", () => {
    // CONTROLS for all three legs.
    expect(positiveTabIndex([PLANTED_TAB_ORDER])).not.toEqual([]);
    expect(positiveTabIndex([CLEAN_STUB])).toEqual([]);
    // ...and a `tabIndex={0}` is NOT a tab-ORDER offence — it keeps DOM order.
    // It is leg 2's offence, and the two must not be conflated: a guard that
    // reported `{0}` here would train whoever hits it to reach for `{1}`.
    expect(positiveTabIndex([PLANTED_STUB])).toEqual([]);
    expect(suppressedFocusRing([PLANTED_STUB_HOVER])).not.toEqual([]);
    expect(suppressedFocusRing([CLEAN_STUB_HOVER])).toEqual([]);
    expect(focusableIn(PLANTED_STUB.source)).not.toEqual([]);

    // LEG 1 — "Tab order is DOM order". A positive `tabIndex` anywhere on the
    // surface is the only way to depart from it, and it departs for the WHOLE
    // page, not just the element carrying it.
    const tree = readAll(FIRST_RUN_TREE);

    expect(positiveTabIndex(tree)).toEqual([]);

    // LEG 2 — "Both stub rows are skipped entirely by Tab (nothing focusable
    // in them)". `tabIndex={-1}` would also skip them, and is still forbidden:
    // an inert row needs no tab index at all, and an explicit one is a control
    // somebody removed from the order rather than never built.
    const stub = readFirstRun(STUB_STEP);

    expect(focusableIn(stub.source)).toEqual([]);
    expect(offenders([stub], /tabIndex/)).toEqual([]);

    // LEG 3 — "`:focus-visible` ring visible on every stop (the global rule in
    // `globals.css` already provides it)". Two ways that promise dies: the
    // global rule is deleted, or a first-run rule sets `outline: none` on top
    // of it. Both are checked, because the checklist row depends on the ring
    // being present at every stop the sequence has.
    const globals = readExisting("apps/web/app/globals.css");

    expect(blankComments(globals.source)).toMatch(/:focus-visible\s*\{[^}]*outline\s*:/);
    expect(suppressedFocusRing([readFirstRun(FIRST_RUN_CSS)])).toEqual([]);
  });
});
