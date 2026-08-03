import { describe, expect, test } from "bun:test";

import {
  blankComments,
  FINDING_CARD,
  FIRST_RUN_COMPONENTS,
  FIRST_RUN_CSS,
  FIRST_RUN_TREE,
  fixture,
  offenders,
  readAll,
  readFirstRun,
  STAGE,
  WAIT_LOG,
  webSources,
} from "./helpers/first-run-source";

interface CssRule {
  readonly selector: string;
  readonly body: string;

  readonly context: readonly string[];
  readonly line: number;
}

function cssRules(source: string): readonly CssRule[] {
  const code = blankComments(source);
  const rules: CssRule[] = [];
  const context: string[] = [];
  let prelude = "";
  let preludeStart = 0;

  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i] ?? "";

    if (ch === "{") {
      const trimmed = prelude.trim();

      if (trimmed.startsWith("@")) {
        context.push(trimmed);
        prelude = "";
        preludeStart = i + 1;
        continue;
      }

      let depth = 0;
      let end = i;
      for (let j = i; j < code.length; j += 1) {
        if (code[j] === "{") depth += 1;
        else if (code[j] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }

      rules.push({
        selector: trimmed,
        body: code.slice(i + 1, end),
        context: [...context],
        line: code.slice(0, preludeStart).split("\n").length,
      });

      i = end;
      prelude = "";
      preludeStart = i + 1;
      continue;
    }

    if (ch === "}") {
      context.pop();
      prelude = "";
      preludeStart = i + 1;
      continue;
    }

    if (prelude === "" && ch.trim() === "") preludeStart = i + 1;
    prelude += ch;
  }

  return rules;
}

const inContext = (rule: CssRule, pattern: RegExp): boolean =>
  rule.context.some((at) => pattern.test(at));

const HOVER_QUERY = /hover\s*:\s*hover/;
const POINTER_FINE = /pointer\s*:\s*fine/;
const REDUCED_MOTION = /prefers-reduced-motion\s*:\s*reduce/;

const openingTags = (source: string): readonly string[] =>
  [...blankComments(source).matchAll(/<[A-Za-z][^<>]*>/g)].map((match) => match[0]);

function enclosingTag(source: string, index: number): string {
  const open = source.lastIndexOf("<", index);
  if (open === -1) return "";
  const close = source.indexOf(">", open);
  return close === -1 ? source.slice(open) : source.slice(open, close + 1);
}

const PLANTED_CSS = fixture(
  "planted.module.css",
  `.stage {
  background: #1d231d;
  border: 1px solid rgba(233, 237, 228, 0.14);
  backdrop-filter: blur(8px);
  transition: all 200ms ease;
}

.stepRow:hover {
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .stage,
  .finding {
    transition-duration: 0.01ms;
    animation: none;
  }
}
`,
);

const CLEAN_CSS = fixture(
  "clean.module.css",
  `.stage {
  background: var(--mantine-color-body);
  border: 1px solid var(--mantine-color-default-border);
  transition: opacity 200ms ease, border-color 200ms ease;
}

@media (hover: hover) {
  .stepRow:hover {
    border-color: var(--mantine-color-default-border);
  }
}

@media (hover: hover) and (pointer: fine) {
  .stepRow:hover {
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .stage {
    transition-duration: 0.01ms;
  }

  .dot {
    animation: none;
  }

  .finding {
    transition: opacity 420ms ease;
  }
}
`,
);

const PLANTED_JS_HOVER = fixture(
  "PlantedHoverStep",
  `export function StepRow() {
  const [lifted, setLifted] = useState(false);
  return <Paper onMouseEnter={() => setLifted(true)} onMouseLeave={() => setLifted(false)} />;
}
`,
);

const CLEAN_CSS_HOVER = fixture(
  "CleanHoverStep",
  `import styles from "./first-run.module.css";

export function StepRow() {
  return <Paper withBorder className={styles.stepRow} />;
}
`,
);

const PLANTED_ANNOUNCED_ELAPSED = fixture(
  "PlantedStageAria",
  `export function Stage({ view }: StageProps) {
  return (
    <div aria-live="polite">
      <ol>{view.lines.map((line) => <li key={line.text}>{line.text}</li>)}</ol>
      <p>{view.elapsedSeconds}</p>
    </div>
  );
}
`,
);

const CLEAN_SILENT_ELAPSED = fixture(
  "CleanStageAria",
  `export function Stage({ view }: StageProps) {
  return (
    <section>
      <WaitLog lines={view.lines} />
      <p aria-live="off">
        <span className={styles.dot} aria-hidden="true" />
        <span aria-hidden="true">{view.elapsedSeconds}</span>
      </p>
    </section>
  );
}
`,
);

const PLANTED_INLINE_TAP = fixture(
  "PlantedTapTarget",
  `const tapTargetStyle = { minWidth: 44, minHeight: 44, touchAction: "manipulation" as const };

export function SlackConnection() {
  return <Button style={tapTargetStyle}>Send a test message</Button>;
}
`,
);

const CLEAN_SHARED_TAP = fixture(
  "CleanTapTarget",
  `import { tapTargetStyle } from "@/components/ui/tap-target";

export function SlackConnection() {
  return <Button style={tapTargetStyle}>{ONBOARDING_MESSAGES.sendTestMessage}</Button>;
}
`,
);

const HEX_LITERAL = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const RGBA_LITERAL = /\brgba?\s*\(/;
const GLASS = /backdrop-filter/i;

const HARDCODED_COLOUR = new RegExp(
  `${HEX_LITERAL.source}|${RGBA_LITERAL.source}|${GLASS.source}`,
  "i",
);

const TRANSITION_ALL = /transition[a-z-]*\s*:\s*["']?\s*all\b/i;

const JS_HOVER = /\bonMouse(?:Enter|Leave|Over|Out)\b/;

const INLINE_TAP_TARGET = /min(?:Width|Height)\s*:\s*44\b/;

const INTERACTIVE =
  /\b(?:Button|ActionIcon|TextInput|PasswordInput|Anchor|Checkbox|Switch|Select)\b/;

const LIVE_DURATION = /(\d+(?:\.\d+)?)\s*(ms|s)\b/g;

const isCollapsed = (declaration: string): boolean =>
  [...declaration.matchAll(LIVE_DURATION)].every(([, value, unit]) => {
    const ms = Number(value) * (unit === "s" ? 1000 : 1);
    return ms <= 0.01;
  });

describe("styling, motion and announcement — B6, UX §5, ESC-O3", () => {
  test("no hex literal, no rgba literal and no backdrop-filter appears in the first-run tree", () => {
    expect(offenders([PLANTED_CSS], HARDCODED_COLOUR)).toHaveLength(3);
    expect(offenders([CLEAN_CSS], HARDCODED_COLOUR)).toEqual([]);

    expect(
      offenders([fixture("Tokens", `color: var(--mantine-color-dimmed);`)], HARDCODED_COLOUR),
    ).toEqual([]);

    expect(
      offenders(
        [fixture("Doc", `/* the old value was #191e19 — never again */`)],
        HARDCODED_COLOUR,
      ),
    ).toEqual([]);

    expect(
      offenders([...readAll(FIRST_RUN_TREE), readFirstRun(FIRST_RUN_CSS)], HARDCODED_COLOUR),
    ).toEqual([]);
  });

  test("no transition: all appears in the first-run tree", () => {
    expect(offenders([PLANTED_CSS], TRANSITION_ALL)).not.toEqual([]);
    expect(offenders([CLEAN_CSS], TRANSITION_ALL)).toEqual([]);

    expect(
      offenders([...readAll(FIRST_RUN_TREE), readFirstRun(FIRST_RUN_CSS)], TRANSITION_ALL),
    ).toEqual([]);
  });

  test("no onMouseEnter or onMouseLeave appears in the first-run tree", () => {
    expect(offenders([PLANTED_JS_HOVER], JS_HOVER)).toHaveLength(1);
    expect(offenders([CLEAN_CSS_HOVER], JS_HOVER)).toEqual([]);

    expect(offenders(readAll(FIRST_RUN_TREE), JS_HOVER)).toEqual([]);
  });

  test("every hover rule is inside a hover media query and every transform lift inside a pointer-fine query", () => {
    const planted = cssRules(PLANTED_CSS.source);
    const clean = cssRules(CLEAN_CSS.source);

    expect(planted.filter((rule) => rule.selector.includes(":hover"))).toHaveLength(1);
    expect(planted.find((rule) => rule.selector.includes(":hover"))?.context).toEqual([]);
    expect(clean.filter((rule) => rule.selector.includes(":hover"))).toHaveLength(2);
    for (const rule of clean.filter((r) => r.selector.includes(":hover"))) {
      expect(inContext(rule, HOVER_QUERY)).toBe(true);
    }

    const rules = cssRules(readFirstRun(FIRST_RUN_CSS).source);
    const hoverRules = rules.filter((rule) => rule.selector.includes(":hover"));

    expect(hoverRules.length).toBeGreaterThan(0);

    expect(
      hoverRules
        .filter((rule) => !inContext(rule, HOVER_QUERY))
        .map((rule) => `${rule.line}: ${rule.selector}`),
    ).toEqual([]);

    expect(
      hoverRules
        .filter((rule) => /transform\s*:/.test(rule.body))
        .filter((rule) => !inContext(rule, POINTER_FINE))
        .map((rule) => `${rule.line}: ${rule.selector}`),
    ).toEqual([]);
  });

  test("prefers-reduced-motion collapses every transition except the arrival fade", () => {
    const plantedReduced = cssRules(PLANTED_CSS.source).filter((rule) =>
      inContext(rule, REDUCED_MOTION),
    );
    expect(plantedReduced).toHaveLength(1);
    expect(plantedReduced.some((rule) => /opacity/.test(rule.body))).toBe(false);

    const cleanReduced = cssRules(CLEAN_CSS.source).filter((rule) =>
      inContext(rule, REDUCED_MOTION),
    );
    expect(cleanReduced.length).toBeGreaterThan(1);
    expect(cleanReduced.some((rule) => /transition[^;]*opacity/.test(rule.body))).toBe(true);

    expect(isCollapsed("transition-duration: 0.01ms;")).toBe(true);
    expect(isCollapsed("transition-duration: 200ms;")).toBe(false);
    expect(isCollapsed("transition: opacity 420ms ease;")).toBe(false);

    const reduced = cssRules(readFirstRun(FIRST_RUN_CSS).source).filter((rule) =>
      inContext(rule, REDUCED_MOTION),
    );

    expect(reduced.length).toBeGreaterThan(0);

    expect(
      reduced
        .filter((rule) => /transition/.test(rule.body) && !/opacity/.test(rule.body))
        .filter((rule) => !isCollapsed(rule.body))
        .map((rule) => `${rule.line}: ${rule.selector}`),
    ).toEqual([]);

    expect(
      reduced.some((rule) =>
        /animation[^;]*:\s*none|animation-play-state\s*:\s*paused/.test(rule.body),
      ),
    ).toBe(true);

    expect(
      reduced.some((rule) => /transition[^;]*opacity/.test(rule.body) && !isCollapsed(rule.body)),
    ).toBe(true);
  });

  test("the elapsed digits are aria-hidden and outside any live region", () => {
    const plantedCode = blankComments(PLANTED_ANNOUNCED_ELAPSED.source);
    const plantedIndex = plantedCode.indexOf("elapsedSeconds");
    expect(plantedIndex).toBeGreaterThan(-1);
    expect(enclosingTag(plantedCode, plantedIndex)).not.toContain("aria-hidden");
    expect(plantedCode).toContain('aria-live="polite"');

    const cleanCode = blankComments(CLEAN_SILENT_ELAPSED.source);
    const cleanIndex = cleanCode.indexOf("elapsedSeconds");
    expect(enclosingTag(cleanCode, cleanIndex)).toContain("aria-hidden");

    const carriers = readAll([STAGE, WAIT_LOG]).filter((scanned) =>
      /elapsedSeconds/.test(blankComments(scanned.source)),
    );

    if (carriers.length === 0) {
      throw new Error(
        `NOT IMPLEMENTED YET: nothing in the stage renders \`elapsedSeconds\`. UX §5 makes the live ` +
          `elapsed one of the three things the wait is built from, and its announcement behaviour is ` +
          `checklist row 31. It is created by ${STAGE.ownedBy}.`,
      );
    }

    for (const scanned of carriers) {
      const code = blankComments(scanned.source);

      for (const match of code.matchAll(/elapsedSeconds/g)) {
        const index = match.index ?? 0;
        const tag = enclosingTag(code, index);

        expect({ file: scanned.file, tag, hidden: /aria-hidden/.test(tag) }).toEqual({
          file: scanned.file,
          tag,
          hidden: true,
        });

        const live = [...code.slice(0, index).matchAll(/aria-live\s*=\s*["']([a-z]+)["']/g)].at(-1);
        expect({ file: scanned.file, live: live?.[1] ?? "off" }).toEqual({
          file: scanned.file,
          live: "off",
        });
      }
    }
  });

  test("the wait log is a polite live region with additions-only relevance", () => {
    expect(
      openingTags(PLANTED_ANNOUNCED_ELAPSED.source).some((tag) => /aria-relevant/.test(tag)),
    ).toBe(false);
    expect(
      openingTags(`<ol aria-live="polite" aria-relevant="additions" className={styles.log}>`).some(
        (tag) =>
          /aria-live\s*=\s*["']polite["']/.test(tag) &&
          /aria-relevant\s*=\s*["']additions["']/.test(tag),
      ),
    ).toBe(true);
    expect(
      openingTags(`<div aria-live="polite"><ol aria-relevant="additions">`).some(
        (tag) => /aria-live/.test(tag) && /aria-relevant/.test(tag),
      ),
    ).toBe(false);

    const log = readFirstRun(WAIT_LOG);

    const announced = openingTags(log.source).filter(
      (tag) =>
        /aria-live\s*=\s*["']polite["']/.test(tag) &&
        /aria-relevant\s*=\s*["']additions["']/.test(tag),
    );

    expect({ file: log.file, politeAdditionsRegions: announced.length > 0 }).toEqual({
      file: log.file,
      politeAdditionsRegions: true,
    });
  });

  test("the finding container carries role=status", () => {
    expect(openingTags(`<article role="status" className={styles.finding}>`)).toHaveLength(1);
    expect(
      openingTags(`<article role="status">`).some((tag) => /role\s*=\s*["']status["']/.test(tag)),
    ).toBe(true);
    expect(
      openingTags(`<article className={styles.finding}>`).some((tag) =>
        /role\s*=\s*["']status["']/.test(tag),
      ),
    ).toBe(false);

    expect(
      openingTags(`<article role="alert">`).some((tag) => /role\s*=\s*["']status["']/.test(tag)),
    ).toBe(false);

    const card = readFirstRun(FINDING_CARD);
    const status = openingTags(card.source).filter((tag) => /role\s*=\s*["']status["']/.test(tag));

    expect({ file: card.file, statusContainers: status.length }).toEqual({
      file: card.file,
      statusContainers: 1,
    });
  });

  test("every interactive control meets the 44px tap target through the shared primitive", () => {
    expect(offenders([PLANTED_INLINE_TAP], INLINE_TAP_TARGET)).not.toEqual([]);
    expect(offenders([CLEAN_SHARED_TAP], INLINE_TAP_TARGET)).toEqual([]);
    expect(INTERACTIVE.test(CLEAN_SHARED_TAP.source)).toBe(true);

    expect(offenders(readAll(FIRST_RUN_TREE), INLINE_TAP_TARGET)).toEqual([]);

    const declarations = webSources().filter((scanned) =>
      INLINE_TAP_TARGET.test(blankComments(scanned.source)),
    );

    expect(declarations.map((scanned) => scanned.file)).toHaveLength(1);

    const home = declarations[0];
    if (home === undefined) throw new Error("unreachable — asserted above");

    const exported = [
      ...blankComments(home.source).matchAll(
        /export\s+const\s+(\w+)[^=]*=\s*\{[^}]*min(?:Width|Height)\s*:\s*44/g,
      ),
    ].map((match) => match[1]);

    expect({ file: home.file, exportedTapTargets: exported }).toEqual({
      file: home.file,
      exportedTapTargets: exported.length === 1 ? exported : [],
    });
    expect(exported).toHaveLength(1);

    const withControls = readAll(FIRST_RUN_COMPONENTS).filter((scanned) =>
      INTERACTIVE.test(blankComments(scanned.source)),
    );

    expect(withControls.length).toBeGreaterThan(0);

    const symbol = exported[0] ?? "";
    for (const scanned of withControls) {
      expect({ file: scanned.file, usesSharedTapTarget: scanned.source.includes(symbol) }).toEqual({
        file: scanned.file,
        usesSharedTapTarget: true,
      });
    }
  });
});
