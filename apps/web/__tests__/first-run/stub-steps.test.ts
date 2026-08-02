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

const stubCopy = (stub: Extract<StepDescriptor, { kind: "coming-next" }>): string =>
  [stub.title, stub.whatItWillDo, stub.filler].join("\n");

interface Ban {
  readonly name: string;
  readonly pattern: RegExp;
}

const found = (bans: readonly Ban[], text: string): readonly string[] =>
  bans.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);

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

const FOCUSABLE_BANS: readonly Ban[] = [
  ...CLICKABLE_BANS,
  { name: "onFocus", pattern: /\bonFocus\b/ },
  { name: "onKeyDown", pattern: /\bonKeyDown\b/ },
  { name: "contentEditable", pattern: /\bcontentEditable\b/ },
  { name: "autoFocus", pattern: /\bautoFocus\b/ },
];

const focusableIn = (source: string): readonly string[] =>
  found(FOCUSABLE_BANS, blankComments(source));

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

const PLANTED_STUB_HOVER = fixture(
  "planted.module.css",
  `.stubRow { opacity: 0.7; }
@media (hover: hover) {
  .stubRow:hover { opacity: 1; cursor: pointer; }
}
.stepRow:focus-visible { outline: none; }
`,
);

const CLEAN_STUB_HOVER = fixture(
  "clean.module.css",
  `.stubRow { opacity: 0.7; }
@media (hover: hover) {
  .stepRow:hover { border-color: var(--mantine-color-default-border); }
}
`,
);

const stubHoverRules = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(
    files,
    /\.[\w-]*stub[\w-]*[^{}]*:hover|:hover[^{}]*\.[\w-]*stub[\w-]*|\.[\w-]*stub[\w-]*[^{}]*\{[^}]*cursor\s*:\s*pointer/i,
  );

const positiveTabIndex = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(files, /tabIndex\s*=\s*\{?\s*["']?[1-9]/);

const suppressedFocusRing = (files: readonly ScannedFile[]): readonly string[] =>
  offenders(files, /outline\s*:\s*(none|0)\b/i);

describe("the shared stub contract — FR-O3, FR-O15, rulings R3 and R5", () => {
  test("neither stub renders a clickable control", () => {
    expect(clickableIn(PLANTED_STUB.source)).toContain("Button");
    expect(clickableIn(PLANTED_STUB.source)).toContain("Tooltip");
    expect(clickableIn(PLANTED_STUB.source)).toContain("tabIndex");
    expect(clickableIn(CLEAN_STUB.source)).toEqual([]);

    expect(clickableIn(`// this component renders no Button and no onClick\n`)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);

    expect(clickableIn(stub.source)).toEqual([]);
  });

  test("the step one stub renders no repo list, no oauth button and no connect field", async () => {
    expect(found(STEP_ONE_BANS, PLANTED_STUB.source)).not.toEqual([]);
    expect(found(STEP_ONE_BANS, CLEAN_STUB.source)).toEqual([]);

    const descriptors = await loadDescriptors();
    const stepOne = stubAt(descriptors, "repo", 1);

    expect(found(STEP_ONE_BANS, stubCopy(stepOne))).toEqual([]);

    expect(stepOne.whatItWillDo).toBe(
      "When this is built, Growthmind will read your code — nothing more — so it can point " +
        "at the right file when it suggests a fix.",
    );
    expect(stepOne.filler).toBe("Not built yet. It arrives with the fix-spec work.");

    const stub = readFirstRun(STUB_STEP);

    expect(found(STEP_ONE_BANS, blankComments(stub.source))).toEqual([]);
  });

  test("the step four stub renders no install command, no url, no protocol version and no verify affordance", async () => {
    expect(found(STEP_FOUR_BANS, PLANTED_STUB.source)).toContain("an install command");
    expect(found(STEP_FOUR_BANS, PLANTED_STUB.source)).toContain("a protocol revision or era");
    expect(found(STEP_FOUR_BANS, CLEAN_STUB.source)).toEqual([]);

    const descriptors = await loadDescriptors();
    const stepFour = stubAt(descriptors, "agent", 4);

    expect(found(STEP_FOUR_BANS, stubCopy(stepFour))).toEqual([]);

    expect(stepFour.filler.trim().length).toBeGreaterThan(0);
    expect(stepFour.whatItWillDo.trim().length).toBeGreaterThan(0);

    const stub = readFirstRun(STUB_STEP);

    expect(found(STEP_FOUR_BANS, blankComments(stub.source))).toEqual([]);
  });

  test("no stub row is a disabled card", () => {
    expect(disabledCardIn(PLANTED_STUB.source)).toContain("Paper");
    expect(disabledCardIn(PLANTED_STUB.source)).toContain("disabled");
    expect(disabledCardIn(PLANTED_STUB.source)).toContain('a "coming soon" pill');
    expect(disabledCardIn(CLEAN_STUB.source)).toEqual([]);

    expect(disabledCardIn(`const state = "coming-next";`)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);

    expect(disabledCardIn(stub.source)).toEqual([]);
  });

  test("neither stub has a hover state or a focus stop", () => {
    expect(stubHoverRules([PLANTED_STUB_HOVER])).not.toEqual([]);
    expect(stubHoverRules([CLEAN_STUB_HOVER])).toEqual([]);
    expect(focusableIn(PLANTED_STUB.source)).not.toEqual([]);
    expect(focusableIn(CLEAN_STUB.source)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);
    const css = readFirstRun(FIRST_RUN_CSS);

    expect(stubHoverRules([css])).toEqual([]);
    expect(focusableIn(stub.source)).toEqual([]);
  });

  test("tab order is DOM order and neither stub is a tab stop", () => {
    expect(positiveTabIndex([PLANTED_TAB_ORDER])).not.toEqual([]);
    expect(positiveTabIndex([CLEAN_STUB])).toEqual([]);

    expect(positiveTabIndex([PLANTED_STUB])).toEqual([]);
    expect(suppressedFocusRing([PLANTED_STUB_HOVER])).not.toEqual([]);
    expect(suppressedFocusRing([CLEAN_STUB_HOVER])).toEqual([]);
    expect(focusableIn(PLANTED_STUB.source)).not.toEqual([]);

    const tree = readAll(FIRST_RUN_TREE);

    expect(positiveTabIndex(tree)).toEqual([]);

    const stub = readFirstRun(STUB_STEP);

    expect(focusableIn(stub.source)).toEqual([]);
    expect(offenders([stub], /tabIndex/)).toEqual([]);

    const globals = readExisting("apps/web/app/globals.css");

    expect(blankComments(globals.source)).toMatch(/:focus-visible\s*\{[^}]*outline\s*:/);
    expect(suppressedFocusRing([readFirstRun(FIRST_RUN_CSS)])).toEqual([]);
  });
});
