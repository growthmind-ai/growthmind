// RENDER PURITY AND THE REDUCER WIRE — task 0g.3. ADD §9, 6 rows. AD-1, AD-3,
// AD-5, AD-18, FR-O22, B1, B3, and AC-O11b's replacement half.
//
// ###########################################################################
// # AC-O11b's DEVIATION, NAMED HERE RATHER THAN DISCOVERED AT GRADING.
// #
// # The acceptance criterion says the D4 proof is "proven by a pure reducer
// # test AND a mounted-component test". THE MOUNTED HALF IS NOT BUILT. There
// # is no DOM test runner in this repository, this sprint does not build one
// # (AD-1), and standing one up is carried as ESC-O1 for its own outcome.
// #
// # It is replaced by two things, and both are real:
// #   1. THIS FILE's first row — a source scan asserting the stage component's
// #      rendered branch is driven by `reduceStage`'s output and derives
// #      nothing itself. A mounted test proves today's tree; this proves it for
// #      every future edit, which is where D4 regressions actually come from.
// #   2. `integration-tester` replaying First-Run Checklist rows 22, 23 and 24
// #      live against the preview — already PR gate 4 in `pr-readiness.md`, and
// #      already the mechanism the UX spec names for checklist replay.
// ###########################################################################
//
// WHAT "RENDER PURITY" MEANS HERE, CONCRETELY. React 19.2 renders a component
// body more than once and at times the author does not choose. A body that
// calls `Date.now()` returns a different tree on each of those renders for
// reasons unrelated to state, which is why UX §5 makes it binding: elapsed is
// STATE updated by the interval callback, never computed in the body. The same
// section makes the interval's disposal binding for a reason that is not
// hygiene — "a running interval after the finding lands is a leak THAT ALSO
// KEEPS RE-RENDERING THE PAYOFF", on the one screen this whole outcome exists
// for.
//
// AND WHY A ONE-HOME RULE IS A CORRECTNESS RULE (FR-O22 / B3). Every
// customer-facing sentence lives in `packages/shared`. A sentence authored in a
// component is the violation — not because two copies are untidy, but because
// the copy audit (`messages.test.ts`'s plain-English walk, the jargon ban, the
// committed-duration ban) only sees the module. A string that never reaches it
// is a string nobody checked, on the surface with the least forgiving reader.
//
// EVERY ROW IS RED TODAY. Wave 7a and 7b own the components; Wave 1a owns the
// types they consume. Reads go through `readSourceUnderConstruction`, so an
// absent file names its own owner instead of surfacing an `ENOENT`.
import { describe, expect, test } from "bun:test";

import {
  anyMatch,
  blankComments,
  COUNTER_GRID,
  FIRST_RUN_TREE,
  fixture,
  offenders,
  readAll,
  readFirstRun,
  STAGE,
  webSourceFiles,
  webSources,
  type ScannedFile,
} from "./helpers/first-run-source";

// ===========================================================================
// Row 1 — the stage derives nothing
// ===========================================================================

/**
 * The six milestone fields, which exist ONLY on `StagePersistedFacts`.
 *
 * None of them is a member of any arm of `RenderedStageState`, so a branch on
 * one of them is unambiguously a branch on the RAW PERSISTED FACTS — a second
 * copy of the reducer's branch order, living in a component, where the ADD's
 * own precedent note says a second copy is "a D11 wire waiting to be severed".
 */
const RAW_FACTS = /\b(armedAt|retrievedAt|readingAt|endedAt|runStatus|runOutcome)\b/;

/**
 * `finding`, but only when it is reached off the STATUS rather than off the
 * reduced state.
 *
 * This distinction is the whole row. `state.kind === "finding"` is not a
 * violation — it IS `reduceStage`'s output, and switching on it is exactly what
 * the component is supposed to do. `status.finding !== null` IS a violation: it
 * re-derives, in a renderer, the branch AD-5 put first on purpose, and it is
 * the specific edit that breaks "a finding persisted before the user landed
 * renders immediately on first paint".
 */
const RAW_FINDING = /\b(status|facts|persisted|props|data|payload)\s*\??\.\s*finding\b/;

/** Anything that makes a line a decision rather than a render. */
const BRANCH = /\bif\s*\(|\?|&&|\|\||\bswitch\s*\(/;

const derivesItsOwnState = (files: readonly ScannedFile[]): readonly string[] =>
  files.flatMap((scanned) =>
    blankComments(scanned.source)
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => BRANCH.test(line) && (RAW_FACTS.test(line) || RAW_FINDING.test(line)))
      .map(({ line, number }) => `${scanned.file}:${number} → ${line.trim()}`),
  );

const PLANTED_DERIVING_STAGE = fixture(
  "PlantedStage",
  `"use client";
export function Stage({ status, nowMs }: StageProps) {
  if (status.finding !== null) return <FindingCard finding={status.finding} />;
  if (status.armedAt === null) return <Unarmed />;
  const leg = status.readingAt !== null ? "leg2" : "leg1";
  return <WaitLog leg={leg} elapsedSeconds={Math.floor((nowMs - status.armedAt.getTime()) / 1000)} />;
}
`,
);

const CLEAN_STAGE = fixture(
  "CleanStage",
  `"use client";
import { reduceStage, renderStageView } from "@growthmind/shared";

export function Stage({ status, nowMs }: StageProps) {
  const state = reduceStage(status, nowMs);
  const view = renderStageView(state);

  return (
    <section>
      <WaitLog view={view} />
      {state.kind === "finding" ? <FindingCard finding={state.finding} /> : null}
      {state.kind === "ended" ? <Ended reason={state.reason} /> : null}
    </section>
  );
}
`,
);

// ===========================================================================
// Row 2 — no `Date.now` in a component body
// ===========================================================================

/**
 * The half-open span of every `setInterval(…)` / `setTimeout(…)` argument list.
 *
 * Brace-matched rather than regex-guessed, because the row is not "never say
 * `Date.now`" — the interval CALLBACK is exactly where UX §5 puts it ("elapsed
 * is state updated by the interval callback"). What is forbidden is the
 * component BODY. A flat ban would push the implementer into a worse shape; a
 * flat allow would prove nothing.
 */
function timerRegions(source: string): readonly (readonly [number, number])[] {
  const regions: [number, number][] = [];

  for (const match of source.matchAll(/\b(?:setInterval|setTimeout)\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;

    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          regions.push([open, i]);
          break;
        }
      }
    }
  }

  return regions;
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/** Every `Date.now` that is NOT inside a timer callback. */
const clockInRender = (files: readonly ScannedFile[]): readonly string[] =>
  files.flatMap((scanned) => {
    const code = blankComments(scanned.source);
    const regions = timerRegions(code);

    return [...code.matchAll(/\bDate\.now\s*\(/g)]
      .map((match) => match.index ?? 0)
      .filter((index) => !regions.some(([start, end]) => index > start && index < end))
      .map(
        (index) => `${scanned.file}:${lineOf(code, index)} → Date.now() outside a timer callback`,
      );
  });

const PLANTED_RENDER_CLOCK = fixture(
  "PlantedElapsed",
  `"use client";
export function Elapsed({ armedAt }: { armedAt: Date }) {
  const elapsed = Math.floor((Date.now() - armedAt.getTime()) / 1000);
  return <span>{elapsed}</span>;
}
`,
);

const CLEAN_RENDER_CLOCK = fixture(
  "CleanElapsed",
  `"use client";
export function Elapsed({ armedAt, terminal }: ElapsedProps) {
  const [nowMs, setNowMs] = useState(() => armedAt.getTime());
  const handle = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (terminal) {
      clearInterval(handle.current);
      return undefined;
    }
    handle.current = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle.current);
  }, [terminal]);

  return <span>{Math.floor((nowMs - armedAt.getTime()) / 1000)}</span>;
}
`,
);

// ===========================================================================
// Row 3 — the interval is disposed of, twice over
// ===========================================================================

/** The effect returns a cleanup that stops the interval — the unmount half. */
const CLEARS_ON_UNMOUNT =
  /return\s*(?:\(\s*\)|\w+)\s*=>\s*(?:\{[\s\S]{0,400}?clearInterval|clearInterval)/;

/**
 * A terminal state stops the interval — the half that is easy to forget.
 *
 * Unmount cleanup is what every React tutorial teaches, and it is not enough
 * here: the user does NOT leave when the finding lands. They stay and read it,
 * while an interval that nobody stopped keeps ticking and keeps re-rendering
 * the payoff underneath them.
 */
const CLEARS_ON_TERMINAL =
  /(?:isTerminal|terminal|["'](?:finding|ended)["'])[\s\S]{0,300}?clearInterval|clearInterval[\s\S]{0,300}?(?:isTerminal|terminal|["'](?:finding|ended)["'])/i;

const PLANTED_UNMOUNT_ONLY = fixture(
  "PlantedInterval",
  `"use client";
export function Stage() {
  const handle = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    handle.current = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle.current);
  }, []);

  return <WaitLog />;
}
`,
);

// ===========================================================================
// Row 4 — the counter's props type
// ===========================================================================

/** `OnboardingCounterView` used as a TYPE, not merely mentioned. */
const NARROWED_PROPS = /(?::|extends|=)\s*(?:readonly\s+)?OnboardingCounterView\b/;

/**
 * The wide type. AD-3 leaves `expectedLag` on the shipped counter deliberately
 * ("narrow at the boundary; do not amputate") — which means the ONLY thing
 * standing between it and a customer is that no component on this surface can
 * reach a type carrying it.
 */
const WIDE_COUNTER = /\bEventsSeenCounter\b/;

const PLANTED_WIDE_COUNTER = fixture(
  "PlantedCounterGrid",
  `import type { EventsSeenCounter } from "@growthmind/shared";

export function CounterGrid({ counter }: { counter: EventsSeenCounter }) {
  return <Text>{counter.expectedLag.statement}</Text>;
}
`,
);

const CLEAN_NARROW_COUNTER = fixture(
  "CleanCounterGrid",
  `import type { OnboardingCounterView } from "@growthmind/shared";

export function CounterGrid({ view }: { view: OnboardingCounterView }) {
  return <SimpleGrid cols={2}>{view.rows.map((row) => <CounterRow key={row.label} {...row} />)}</SimpleGrid>;
}
`,
);

// ===========================================================================
// Row 5 — the field that must not be reachable
// ===========================================================================

/**
 * AD-3's repo-wide scan. `describeExpectedLag` computes
 * `pollIntervalSeconds + 25` and `+ 220`; with the shipped column default of 60
 * that is the sentence "85 seconds… 280 seconds" rendered in front of a
 * customer, failing FR-O18 and FR-O22 in one line — on a surface whose binding
 * rule B2 is that NO string commits to a duration.
 */
const BANNED_FIELD = /\bexpectedLag\b/;

// ===========================================================================
// Row 6 — no sentence authored in a component
// ===========================================================================

/**
 * A run of six or more prose words.
 *
 * SIX IS A CHOICE AND IT IS STATED, because the ADD's row says "over N words"
 * without fixing N. Six is comfortably above anything TypeScript produces
 * incidentally and comfortably below every sentence in the UX spec's normative
 * copy column — the shortest of which, "Not built yet. It arrives with the
 * fix-spec work.", is nine.
 *
 * The scan reads code AND quoted strings, because the offence takes both
 * shapes: a `<Text>` child is bare JSX, an `aria-label` is a quoted literal,
 * and both put a sentence on the screen that the copy audit never saw.
 */
const PROSE_RUN = /\b[A-Za-z][A-Za-z'’-]*(?:[,;:]?\s+[A-Za-z][A-Za-z'’-]*){5,}/;

/**
 * Module specifiers are excluded, and only module specifiers.
 *
 * `import { Box, Group, Stack, Text, Title } from "@mantine/core"` is five
 * comma-separated identifiers and the word `from` — six "words" by any prose
 * measure and prose by none. It is the one construct in TypeScript that
 * reliably produces a false run, so it is the one exclusion.
 */
const MODULE_SPECIFIER =
  /^\s*(?:import|export)\b[^;]*\bfrom\b|^\s*(?:import|export)\s*\{|^\s*\}\s*from\b/;

const inlineSentences = (files: readonly ScannedFile[]): readonly string[] =>
  files.flatMap((scanned) =>
    blankComments(scanned.source)
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => !MODULE_SPECIFIER.test(line) && PROSE_RUN.test(line))
      .map(({ line, number }) => `${scanned.file}:${number} → ${line.trim()}`),
  );

const PLANTED_INLINE_COPY = fixture(
  "PlantedStubCopy",
  `import { Box, Text } from "@mantine/core";

export function StubStep() {
  return (
    <Box>
      <Text>When this is built, Growthmind will read your code — nothing more.</Text>
      <Text aria-label="Not built yet, it arrives with the fix-spec work">Not built yet.</Text>
    </Box>
  );
}
`,
);

const CLEAN_IMPORTED_COPY = fixture(
  "CleanStubCopy",
  `import { Box, Group, Stack, Text, Title } from "@mantine/core";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

export function StubStep({ step }: StubStepProps) {
  return (
    <Box>
      <Text c="dimmed">{step.whatItWillDo}</Text>
      <Text c="dimmed">{ONBOARDING_MESSAGES.stubFiller}</Text>
    </Box>
  );
}
`,
);

// ###########################################################################
describe("render purity and the reducer wire — AD-1, AD-3, AD-5, AC-O11b", () => {
  // -------------------------------------------------------------- §9 row 1
  test("the stage component derives nothing — it renders reduceStage's output", () => {
    // BOTH CONTROLS FIRST. The planted stage is not a strawman: it is the
    // storyboard's own demo reducer inlined into a component, which is exactly
    // what an implementer reading the playable prototype would write.
    expect(derivesItsOwnState([PLANTED_DERIVING_STAGE])).not.toEqual([]);
    expect(derivesItsOwnState([CLEAN_STAGE])).toEqual([]);

    // AND THE DISTINCTION THAT MAKES THIS ROW MEAN ANYTHING: branching on the
    // REDUCER'S OUTPUT is the component's job. `state.kind === "finding"` must
    // never be reported, or the row would forbid rendering.
    expect(
      derivesItsOwnState([
        fixture(
          "Legit",
          `{state.kind === "finding" ? <FindingCard finding={state.finding} /> : null}`,
        ),
      ]),
    ).toEqual([]);

    const stage = readFirstRun(STAGE);
    const code = blankComments(stage.source);

    // THE WIRE ITSELF. A stage that never calls the reducer has no branch order
    // to violate — and no D4 guarantee either.
    if (!/\breduceStage\b/.test(code)) {
      throw new Error(
        `NOT IMPLEMENTED YET: ${STAGE.repoRelativePath} does not call \`reduceStage\`. AD-5 puts the ` +
          `branch order in ONE home because a second copy is a D11 wire waiting to be severed, and ` +
          `AC-O11b's D4 proof rests on the component rendering the reducer's output rather than ` +
          `re-deriving it. It is created by ${STAGE.ownedBy}.`,
      );
    }

    expect(code).toMatch(/\brenderStageView\b/);
    expect(derivesItsOwnState([stage])).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 2
  test("no component body calls Date.now", () => {
    // CONTROLS. Both fixtures contain `Date.now`; only one calls it in render.
    expect(clockInRender([PLANTED_RENDER_CLOCK])).not.toEqual([]);
    expect(CLEAN_RENDER_CLOCK.source).toContain("Date.now");
    expect(clockInRender([CLEAN_RENDER_CLOCK])).toEqual([]);

    // ...and a comment describing the rule is not a violation of it.
    expect(clockInRender([fixture("Doc", `// never call Date.now() in a body\n`)])).toEqual([]);

    // React 19.2 render purity (UX §5, binding). Elapsed counts up from a
    // PERSISTED origin, so a backgrounded tab, a slow frame and a hard reload
    // all return the right number — which is the property checklist rows 22
    // and 23 are testing, one layer up.
    expect(clockInRender(readAll(FIRST_RUN_TREE))).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 3
  test("the elapsed interval is cleared on unmount and on every terminal state", () => {
    // CONTROLS. The planted component is the COMMON, PLAUSIBLE mistake — the
    // textbook cleanup, correct as far as it goes and silent about the case
    // that matters here.
    expect(CLEARS_ON_UNMOUNT.test(PLANTED_UNMOUNT_ONLY.source)).toBe(true);
    expect(CLEARS_ON_TERMINAL.test(PLANTED_UNMOUNT_ONLY.source)).toBe(false);
    expect(CLEARS_ON_UNMOUNT.test(CLEAN_RENDER_CLOCK.source)).toBe(true);
    expect(CLEARS_ON_TERMINAL.test(CLEAN_RENDER_CLOCK.source)).toBe(true);

    const tree = readAll(FIRST_RUN_TREE);
    const owners = tree.filter((scanned) =>
      /\bsetInterval\s*\(/.test(blankComments(scanned.source)),
    );

    // NON-VACUITY. If no file starts an interval, this row would pass over an
    // empty set — and the surface would have no live elapsed at all, which is
    // its own failure (AD-18: one client interval polls the status route).
    if (owners.length === 0) {
      throw new Error(
        `NOT IMPLEMENTED YET: nothing in the first-run tree calls \`setInterval\`. AD-18 polls ` +
          `\`GET /api/first-run/status\` on one client interval while the stage is open, and UX §5 ` +
          `makes the elapsed readout state updated by that interval's callback. It is created by ` +
          `${STAGE.ownedBy}.`,
      );
    }

    for (const scanned of owners) {
      const code = blankComments(scanned.source);
      expect({ file: scanned.file, clearsOnUnmount: CLEARS_ON_UNMOUNT.test(code) }).toEqual({
        file: scanned.file,
        clearsOnUnmount: true,
      });
      expect({ file: scanned.file, clearsOnTerminal: CLEARS_ON_TERMINAL.test(code) }).toEqual({
        file: scanned.file,
        clearsOnTerminal: true,
      });
    }
  });

  // -------------------------------------------------------------- §9 row 4
  test("the counter component's props type is OnboardingCounterView", () => {
    // CONTROLS.
    expect(NARROWED_PROPS.test(PLANTED_WIDE_COUNTER.source)).toBe(false);
    expect(WIDE_COUNTER.test(PLANTED_WIDE_COUNTER.source)).toBe(true);
    expect(NARROWED_PROPS.test(CLEAN_NARROW_COUNTER.source)).toBe(true);
    expect(WIDE_COUNTER.test(CLEAN_NARROW_COUNTER.source)).toBe(false);

    const counter = readFirstRun(COUNTER_GRID);
    const code = blankComments(counter.source);

    // AD-3: "`expectedLag` is not a property IN SCOPE inside any component on
    // this surface — rendering it is a compile error, not a discipline." That
    // sentence is only true if the props type is the narrowed one, so this row
    // is what makes row 5 structural rather than aspirational.
    expect({ file: counter.file, narrowed: NARROWED_PROPS.test(code) }).toEqual({
      file: counter.file,
      narrowed: true,
    });

    // And the wide type is unreachable from ANYWHERE on the surface, not just
    // from the counter — a sibling importing it would hand the field back.
    expect(offenders(readAll(FIRST_RUN_TREE), WIDE_COUNTER)).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 5
  test("expectedLag appears nowhere under apps/web", () => {
    // CONTROLS.
    expect(offenders([PLANTED_WIDE_COUNTER], BANNED_FIELD)).not.toEqual([]);
    expect(offenders([CLEAN_NARROW_COUNTER], BANNED_FIELD)).toEqual([]);

    // THE WALK'S OWN EXCLUSION, ASSERTED. The scan covers PRODUCTION source and
    // deliberately not `__tests__` — this row has to name the field to ban it,
    // and so does Wave 0f's "the response carries no expectedLag anywhere". A
    // guard that cannot be written without failing itself is not a guard, and
    // the invariant that matters is that no COMPONENT can reach the field.
    const files = webSourceFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((file) => file.includes("__tests__"))).toEqual([]);

    // NON-VACUITY, AND IT IS WHY THIS ROW IS RED RATHER THAN GREEN TODAY.
    //
    // A repo-wide ABSENCE claim is trivially true on a tree that has no
    // counter, no strip and no surface — this row would have reported green on
    // the Wave 0 branch while proving nothing whatsoever, which is the single
    // most dangerous shape a guard can take (the ADD's §10 warns that a prior
    // sprint marked four rows done from intent alone). So the row asserts the
    // subject exists BEFORE asserting the field does not: `apps/web` must
    // contain a counter component, and THAT tree must not name the field.
    readFirstRun(COUNTER_GRID);

    expect(offenders(webSources(), BANNED_FIELD, "raw")).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 6
  test("no component authors a customer-facing sentence inline", () => {
    // CONTROLS, in both encodings the offence takes.
    expect(inlineSentences([PLANTED_INLINE_COPY])).toHaveLength(2);
    expect(inlineSentences([CLEAN_IMPORTED_COPY])).toEqual([]);

    // The one deliberate exclusion, proven not to be a hole: a module specifier
    // is skipped, and a sentence on the SAME LINE as one is still reported.
    expect(inlineSentences([fixture("Imports", `import { A, B, C, D, E, F } from "x";`)])).toEqual(
      [],
    );

    // ...and the file's own header prose is comment, not code.
    expect(
      inlineSentences([fixture("Header", `// this component authors no sentence of its own\n`)]),
    ).toEqual([]);

    // B3/FR-O22: every state, refusal, counter label, post-failure and analysis
    // sentence is IMPORTED from the shipped tables. The genuinely new strings
    // live in `packages/shared/src/onboarding/messages.ts`, which has its own
    // plain-English audit (AD-4) — and a sentence that never lands there is a
    // sentence nobody audited.
    expect(inlineSentences(readAll(FIRST_RUN_TREE))).toEqual([]);

    // The surface must actually import its copy from the one home, or the row
    // above is satisfied by a component that renders no words at all.
    expect(anyMatch(readAll(FIRST_RUN_TREE), /@growthmind\/shared/)).toBe(true);
  });
});
