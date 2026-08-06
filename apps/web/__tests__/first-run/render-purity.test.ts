import { describe, expect, test } from "bun:test";

import {
  AGENT_PANEL,
  AGENT_PANEL_BODY,
  anyMatch,
  blankComments,
  COPYABLE_BLOCK,
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

const RAW_FACTS = /\b(armedAt|retrievedAt|readingAt|endedAt|runStatus|runOutcome)\b/;

const RAW_FINDING = /\b(status|facts|persisted|props|data|payload)\s*\??\.\s*finding\b/;

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

const CLEARS_ON_UNMOUNT =
  /return\s*(?:\(\s*\)|\w+)\s*=>\s*(?:\{[\s\S]{0,400}?clearInterval|clearInterval)/;

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

const NARROWED_PROPS = /(?::|extends|=)\s*(?:readonly\s+)?OnboardingCounterView\b/;

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

const BANNED_FIELD = /\bexpectedLag\b/;

const PROSE_RUN = /\b[A-Za-z][A-Za-z'’-]*(?:[,;:]?\s+[A-Za-z][A-Za-z'’-]*){5,}/;

const MODULE_SPECIFIER =
  /^\s*(?:import|export)\b[^;]*\bfrom\b|^\s*(?:import|export)\s*\{|^\s*\}\s*from\b/;

// `const localName = SHARED_CONSTANT as "its exact text";` is not authored copy — the
// `as` cast only typechecks when the two literal string types are identical, so this
// shape can only ever re-quote a real imported constant's value (an unrelated string
// fails to typecheck, per TS's "neither type sufficiently overlaps" rule). It exists for
// the rare component this test suite must prove renders specific copy without a DOM
// renderer, by scanning source text — see `finding-card-dismiss.test.ts`.
const PINNED_SHARED_CONSTANT =
  /^\s*const\s+[A-Za-z_$][\w$]*\s*=\s*[A-Z][A-Z0-9_]*\s+as\s+"[^"]*"\s*;\s*$/;

const inlineSentences = (files: readonly ScannedFile[]): readonly string[] =>
  files.flatMap((scanned) =>
    blankComments(scanned.source)
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(
        ({ line }) =>
          !MODULE_SPECIFIER.test(line) &&
          !PINNED_SHARED_CONSTANT.test(line) &&
          PROSE_RUN.test(line),
      )
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

describe("render purity and the reducer wire — AD-1, AD-3, AD-5, AC-O11b", () => {
  test("the stage component derives nothing — it renders reduceStage's output", () => {
    expect(derivesItsOwnState([PLANTED_DERIVING_STAGE])).not.toEqual([]);
    expect(derivesItsOwnState([CLEAN_STAGE])).toEqual([]);

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

  test("no component body calls Date.now", () => {
    expect(clockInRender([PLANTED_RENDER_CLOCK])).not.toEqual([]);
    expect(CLEAN_RENDER_CLOCK.source).toContain("Date.now");
    expect(clockInRender([CLEAN_RENDER_CLOCK])).toEqual([]);

    expect(clockInRender([fixture("Doc", `// never call Date.now() in a body\n`)])).toEqual([]);

    expect(clockInRender(readAll(FIRST_RUN_TREE))).toEqual([]);
  });

  test("the elapsed interval is cleared on unmount and on every terminal state", () => {
    expect(CLEARS_ON_UNMOUNT.test(PLANTED_UNMOUNT_ONLY.source)).toBe(true);
    expect(CLEARS_ON_TERMINAL.test(PLANTED_UNMOUNT_ONLY.source)).toBe(false);
    expect(CLEARS_ON_UNMOUNT.test(CLEAN_RENDER_CLOCK.source)).toBe(true);
    expect(CLEARS_ON_TERMINAL.test(CLEAN_RENDER_CLOCK.source)).toBe(true);

    const tree = readAll(FIRST_RUN_TREE);
    const owners = tree.filter((scanned) =>
      /\bsetInterval\s*\(/.test(blankComments(scanned.source)),
    );

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

  test("the counter component's props type is OnboardingCounterView", () => {
    expect(NARROWED_PROPS.test(PLANTED_WIDE_COUNTER.source)).toBe(false);
    expect(WIDE_COUNTER.test(PLANTED_WIDE_COUNTER.source)).toBe(true);
    expect(NARROWED_PROPS.test(CLEAN_NARROW_COUNTER.source)).toBe(true);
    expect(WIDE_COUNTER.test(CLEAN_NARROW_COUNTER.source)).toBe(false);

    const counter = readFirstRun(COUNTER_GRID);
    const code = blankComments(counter.source);

    expect({ file: counter.file, narrowed: NARROWED_PROPS.test(code) }).toEqual({
      file: counter.file,
      narrowed: true,
    });

    expect(offenders(readAll(FIRST_RUN_TREE), WIDE_COUNTER)).toEqual([]);
  });

  test("expectedLag appears nowhere under apps/web", () => {
    expect(offenders([PLANTED_WIDE_COUNTER], BANNED_FIELD)).not.toEqual([]);
    expect(offenders([CLEAN_NARROW_COUNTER], BANNED_FIELD)).toEqual([]);

    const files = webSourceFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((file) => file.includes("__tests__"))).toEqual([]);

    readFirstRun(COUNTER_GRID);

    expect(offenders(webSources(), BANNED_FIELD, "raw")).toEqual([]);
  });

  test("the agent panel trio authors no customer-facing sentence and calls no clock", () => {
    const trio = readAll([AGENT_PANEL, AGENT_PANEL_BODY, COPYABLE_BLOCK]);

    expect(inlineSentences(trio)).toEqual([]);
    expect(clockInRender(trio)).toEqual([]);

    expect(anyMatch(trio, /@growthmind\/shared/)).toBe(true);
  });

  test("no component authors a customer-facing sentence inline", () => {
    expect(inlineSentences([PLANTED_INLINE_COPY])).toHaveLength(2);
    expect(inlineSentences([CLEAN_IMPORTED_COPY])).toEqual([]);

    expect(inlineSentences([fixture("Imports", `import { A, B, C, D, E, F } from "x";`)])).toEqual(
      [],
    );

    expect(
      inlineSentences([fixture("Header", `// this component authors no sentence of its own\n`)]),
    ).toEqual([]);

    expect(inlineSentences(readAll(FIRST_RUN_TREE))).toEqual([]);

    expect(anyMatch(readAll(FIRST_RUN_TREE), /@growthmind\/shared/)).toBe(true);
  });
});
