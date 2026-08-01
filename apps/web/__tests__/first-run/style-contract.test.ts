// STYLING, MOTION AND ANNOUNCEMENT — task 0g.4. ADD §9, 9 rows. Binding rule
// B6, UX §5's interaction standards and its announcement table, and the
// storyboard's transition spec T1-T14.
//
// ###########################################################################
// # ESC-O3 IS A NAMED SHORTFALL, NOT A GAP THIS FILE TRIES TO CLOSE.
// #
// # The acceptance criterion reads "verified in both light and dark mode".
// # THAT IS NOT EXECUTABLE HERE: the app is dark-only by construction
// # (`layout.tsx:21,28,31`; `theme.ts:5-6`) and ships no colour-scheme toggle.
// # An honest tester marks it N/A. The UX escalated it, AD-24 accepts it, and
// # the ADD's escalation register carries it as ESC-O3 for a PM decision —
// # reword the criterion, or scope a toggle as its own outcome.
// #
// # **DO NOT ADD A COLOUR-SCHEME TOGGLE TO SATISFY THIS FILE.** That is a
// # different outcome and it would be scope invented by a test.
// #
// # B6 IS WHAT THE CRITERION ACTUALLY PROTECTS, and B6 is testable today: no
// # hex, no `rgba()`, no `backdrop-filter`, no dark glass — colour exclusively
// # through Mantine semantic tokens and the theme tuples. The canonical prior
// # incident in this repository was AN ONBOARDING PAGE INVISIBLE IN LIGHT MODE,
// # and every one of those was a hardcoded value, not a missing toggle. Row 1
// # is that incident, made impossible.
// ###########################################################################
//
// WHY THE ANNOUNCEMENT ROWS (6, 7, 8) ARE P0 AND NOT POLISH. The stage is the
// one place on this surface where meaningful content arrives WITHOUT the user
// acting. Silence there for a non-sighted user is the same failure as an
// unlabelled spinner for a sighted one — and UX §5 says the naïve fix makes it
// WORSE, because a per-second elapsed readout inside a live region announces
// "38 seconds… 39 seconds… 40 seconds" over the top of the narration it was
// meant to support. The three rows encode the whole table: the log announces,
// the elapsed does not, the payoff announces once.
//
// EVERY ROW IS RED TODAY. Wave 7b owns `first-run.module.css`, `Stage.tsx`,
// `WaitLog.tsx` and `FindingCard.tsx`; Wave 7a owns the rest. Reads go through
// `readSourceUnderConstruction`, so an absent file names its own owner.
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

// ===========================================================================
// A CSS reader — enough of one, and no more
// ===========================================================================

/** One declaration block, with the at-rule context it sits inside. */
interface CssRule {
  readonly selector: string;
  readonly body: string;
  /** Every enclosing at-rule prelude, outermost first. */
  readonly context: readonly string[];
  readonly line: number;
}

/**
 * Every declaration block in a stylesheet, with its `@media` context.
 *
 * Rows 4 and 5 are not "does this string appear" questions — they are
 * questions about WHERE a rule sits. "Every hover rule is inside a hover media
 * query" cannot be answered by grepping for `@media (hover: hover)`, because a
 * stylesheet can contain that query AND a bare `:hover` rule outside it, which
 * is precisely the bug: the bare rule fires on touch, where it sticks after a
 * tap and reads as a broken control.
 *
 * A brace walk, not a CSS parser. It handles nesting and at-rules and nothing
 * else, which is all a CSS module in this repository contains.
 */
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

// ===========================================================================
// A JSX reader — the opening tags, and what encloses an index
// ===========================================================================

/** Every opening tag in a TSX source, as raw text. */
const openingTags = (source: string): readonly string[] =>
  [...blankComments(source).matchAll(/<[A-Za-z][^<>]*>/g)].map((match) => match[0]);

/**
 * The opening tag that encloses a character index.
 *
 * Used by row 6, whose claim is about WHICH ELEMENT carries `aria-hidden` — not
 * whether the file mentions it somewhere. A file can carry both an
 * `aria-hidden` and an announced elapsed readout without them being the same
 * element, and that file passes a naïve substring check while failing the
 * checklist row live.
 */
function enclosingTag(source: string, index: number): string {
  const open = source.lastIndexOf("<", index);
  if (open === -1) return "";
  const close = source.indexOf(">", open);
  return close === -1 ? source.slice(open) : source.slice(open, close + 1);
}

// ===========================================================================
// The fixtures
// ===========================================================================

/**
 * THE OFFENDING STYLESHEET, AND EVERY LINE OF IT IS A REAL MISTAKE.
 *
 * A hardcoded panel colour (the invisible-in-light-mode incident), a dark-glass
 * blur, `transition: all`, a bare `:hover` outside any query, a `transform`
 * lift that fires on touch, and a reduced-motion block that flattens the
 * arrival's fade along with everything else — which silently removes the one
 * announcement a reduced-motion user still gets.
 */
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

/** The same stylesheet, built to B6 and UX §5. */
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

export function ConnectSlackForm() {
  return <Button style={tapTargetStyle}>Send a test message</Button>;
}
`,
);

const CLEAN_SHARED_TAP = fixture(
  "CleanTapTarget",
  `import { tapTargetStyle } from "@/components/ui/tap-target";

export function ConnectSlackForm() {
  return <Button style={tapTargetStyle}>{ONBOARDING_MESSAGES.sendTestMessage}</Button>;
}
`,
);

// ===========================================================================
// The scanners
// ===========================================================================

/** A colour value written by hand rather than taken from a token. */
const HEX_LITERAL = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const RGBA_LITERAL = /\brgba?\s*\(/;
const GLASS = /backdrop-filter/i;

const HARDCODED_COLOUR = new RegExp(
  `${HEX_LITERAL.source}|${RGBA_LITERAL.source}|${GLASS.source}`,
  "i",
);

const TRANSITION_ALL = /transition[a-z-]*\s*:\s*["']?\s*all\b/i;

/**
 * Hover handled in JavaScript. UX §5: "flagged CRITICAL IN REVIEW IF PRESENT".
 *
 * `onMouseOver`/`onMouseOut` are on the list too. The ADD names two; these are
 * the same offence spelled differently, and a ban pinned to one spelling is the
 * D9 shape this repository already pays for elsewhere.
 */
const JS_HOVER = /\bonMouse(?:Enter|Leave|Over|Out)\b/;

/** A 44px tap target written out by hand rather than imported. */
const INLINE_TAP_TARGET = /min(?:Width|Height)\s*:\s*44\b/;

/** An interactive control — a thing that must meet the tap target. */
const INTERACTIVE =
  /\b(?:Button|ActionIcon|TextInput|PasswordInput|Anchor|Checkbox|Switch|Select)\b/;

/** A transition that has NOT been collapsed. */
const LIVE_DURATION = /(\d+(?:\.\d+)?)\s*(ms|s)\b/g;

const isCollapsed = (declaration: string): boolean =>
  [...declaration.matchAll(LIVE_DURATION)].every(([, value, unit]) => {
    const ms = Number(value) * (unit === "s" ? 1000 : 1);
    return ms <= 0.01;
  });

// ###########################################################################
describe("styling, motion and announcement — B6, UX §5, ESC-O3", () => {
  // -------------------------------------------------------------- §9 row 1
  test("no hex literal, no rgba literal and no backdrop-filter appears in the first-run tree", () => {
    // BOTH CONTROLS FIRST.
    expect(offenders([PLANTED_CSS], HARDCODED_COLOUR)).toHaveLength(3);
    expect(offenders([CLEAN_CSS], HARDCODED_COLOUR)).toEqual([]);

    // A token reference is not a literal — the guard must not forbid the thing
    // it is steering people towards.
    expect(
      offenders([fixture("Tokens", `color: var(--mantine-color-dimmed);`)], HARDCODED_COLOUR),
    ).toEqual([]);

    // ...and a comment quoting the old palette is documentation, not a value.
    expect(
      offenders(
        [fixture("Doc", `/* the old value was #191e19 — never again */`)],
        HARDCODED_COLOUR,
      ),
    ).toEqual([]);

    // ESC-O3, restated where it bites: this is what "verified in both modes"
    // was protecting. Colour comes exclusively from Mantine semantic tokens and
    // the theme tuples (`band`, `stamp`, `dark`) — every one of which resolves
    // per scheme, which a hex never does.
    expect(
      offenders([...readAll(FIRST_RUN_TREE), readFirstRun(FIRST_RUN_CSS)], HARDCODED_COLOUR),
    ).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 2
  test("no transition: all appears in the first-run tree", () => {
    // CONTROLS.
    expect(offenders([PLANTED_CSS], TRANSITION_ALL)).not.toEqual([]);
    expect(offenders([CLEAN_CSS], TRANSITION_ALL)).toEqual([]);

    // `transition: all` animates properties nobody chose, including the ones a
    // reduced-motion user asked not to see and the ones the reload path (T13)
    // must mount already-settled. An explicit property list is the only way
    // either promise survives a later style edit.
    expect(
      offenders([...readAll(FIRST_RUN_TREE), readFirstRun(FIRST_RUN_CSS)], TRANSITION_ALL),
    ).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 3
  test("no onMouseEnter or onMouseLeave appears in the first-run tree", () => {
    // CONTROLS.
    expect(offenders([PLANTED_JS_HOVER], JS_HOVER)).toHaveLength(1);
    expect(offenders([CLEAN_CSS_HOVER], JS_HOVER)).toEqual([]);

    // Hover in JavaScript never fires on touch, so the state it drives is
    // simply absent on a phone — and this surface is designed mobile-first. It
    // also re-renders on pointer movement, over a stage that is already
    // re-rendering once a second.
    expect(offenders(readAll(FIRST_RUN_TREE), JS_HOVER)).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 4
  test("every hover rule is inside a hover media query and every transform lift inside a pointer-fine query", () => {
    // CONTROLS — and they exercise the PARSER, not just a regex, because the
    // whole row is about a rule's position rather than its text.
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

    // NON-VACUITY. A stylesheet with no hover rules passes both clauses below
    // while proving nothing, and a surface built from Mantine cards has them.
    expect(hoverRules.length).toBeGreaterThan(0);

    // A bare `:hover` fires on touch, where it STICKS after a tap — the control
    // stays lit until the user taps elsewhere, which reads as a stuck state.
    expect(
      hoverRules
        .filter((rule) => !inContext(rule, HOVER_QUERY))
        .map((rule) => `${rule.line}: ${rule.selector}`),
    ).toEqual([]);

    // The lift is narrower still: a `transform` on hover needs a FINE pointer,
    // or a stylus and a trackpad-less touch device inherit an animation aimed
    // at a mouse.
    expect(
      hoverRules
        .filter((rule) => /transform\s*:/.test(rule.body))
        .filter((rule) => !inContext(rule, POINTER_FINE))
        .map((rule) => `${rule.line}: ${rule.selector}`),
    ).toEqual([]);
  });

  // -------------------------------------------------------------- §9 row 5
  // Covers First-Run Checklist row 17's motion half.
  test("prefers-reduced-motion collapses every transition except the arrival fade", () => {
    // CONTROLS. The planted block is the WELL-INTENTIONED version — it does
    // collapse everything, which is what most reduced-motion blocks do, and in
    // doing so it flattens the one fade UX §5 explicitly keeps.
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

    // ...and the duration reader actually reads durations.
    expect(isCollapsed("transition-duration: 0.01ms;")).toBe(true);
    expect(isCollapsed("transition-duration: 200ms;")).toBe(false);
    expect(isCollapsed("transition: opacity 420ms ease;")).toBe(false);

    const reduced = cssRules(readFirstRun(FIRST_RUN_CSS).source).filter((rule) =>
      inContext(rule, REDUCED_MOTION),
    );

    // NON-VACUITY — the block has to exist at all.
    expect(reduced.length).toBeGreaterThan(0);

    // EVERYTHING COLLAPSES... except a declaration that names `opacity`, which
    // is the carve-out below.
    expect(
      reduced
        .filter((rule) => /transition/.test(rule.body) && !/opacity/.test(rule.body))
        .filter((rule) => !isCollapsed(rule.body))
        .map((rule) => `${rule.line}: ${rule.selector}`),
    ).toEqual([]);

    // THE BREATHING DOT STOPS. It is the surface's only ambient animation and
    // it runs for the whole wait — the single most likely thing to make a
    // motion-sensitive user leave the screen this outcome exists to hold them
    // on.
    expect(
      reduced.some((rule) =>
        /animation[^;]*:\s*none|animation-play-state\s*:\s*paused/.test(rule.body),
      ),
    ).toBe(true);

    // AND THE ARRIVAL'S FADE IS KEPT — "so the payoff is still announced to a
    // user who has asked for less motion" (UX §5, binding). A carve-out, not an
    // oversight: the block must RE-DECLARE a live opacity transition, which is
    // the only structural difference between keeping it and forgetting it.
    expect(
      reduced.some((rule) => /transition[^;]*opacity/.test(rule.body) && !isCollapsed(rule.body)),
    ).toBe(true);
  });

  // -------------------------------------------------------------- §9 row 6
  // Covers First-Run Checklist row 31 (elapsed half).
  test("the elapsed digits are aria-hidden and outside any live region", () => {
    // CONTROLS. The planted stage is the NAÏVE FIX for the accessibility
    // requirement above it: wrap the whole wait in a live region so the log is
    // announced. It announces the elapsed too, once a second, forever.
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

    // NON-VACUITY: something has to render the elapsed readout, or the wait has
    // no visible motion at all and the row asserts nothing.
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

        // The digits themselves are hidden from assistive tech...
        expect({ file: scanned.file, tag, hidden: /aria-hidden/.test(tag) }).toEqual({
          file: scanned.file,
          tag,
          hidden: true,
        });

        // ...and the nearest live region above them is `off`. "The log's own
        // stamps already carry the timing" (UX §5) — the information is not
        // lost, it is delivered once per event instead of once per second.
        const live = [...code.slice(0, index).matchAll(/aria-live\s*=\s*["']([a-z]+)["']/g)].at(-1);
        expect({ file: scanned.file, live: live?.[1] ?? "off" }).toEqual({
          file: scanned.file,
          live: "off",
        });
      }
    }
  });

  // -------------------------------------------------------------- §9 row 7
  // Covers First-Run Checklist row 31 (log half).
  test("the wait log is a polite live region with additions-only relevance", () => {
    // CONTROLS — and they are TAG-scoped, because two attributes present in one
    // file but on two different elements satisfy a substring check and nothing
    // else. `aria-relevant="additions"` on a container whose live region is a
    // sibling does nothing at all.
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

    // "Each appended fact is announced ONCE, as it becomes true — this is the
    // whole narration for a non-sighted user" (UX §5). `additions` is what
    // stops a re-render re-reading the lines that were already there, which is
    // the same failure as the elapsed counter one row up, arriving by a
    // different route.
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

  // -------------------------------------------------------------- §9 row 8
  // Covers First-Run Checklist row 31 (payoff half).
  test("the finding container carries role=status", () => {
    // CONTROLS.
    expect(openingTags(`<article role="status" className={styles.finding}>`)).toHaveLength(1);
    expect(
      openingTags(`<article role="status">`).some((tag) => /role\s*=\s*["']status["']/.test(tag)),
    ).toBe(true);
    expect(
      openingTags(`<article className={styles.finding}>`).some((tag) =>
        /role\s*=\s*["']status["']/.test(tag),
      ),
    ).toBe(false);
    // `role="alert"` is NOT an acceptable substitute — it is assertive, and it
    // would interrupt whatever the user is being read mid-sentence. The payoff
    // is announced, not shouted.
    expect(
      openingTags(`<article role="alert">`).some((tag) => /role\s*=\s*["']status["']/.test(tag)),
    ).toBe(false);

    const card = readFirstRun(FINDING_CARD);
    const status = openingTags(card.source).filter((tag) => /role\s*=\s*["']status["']/.test(tag));

    // "The payoff must be announced. `role="status"` is polite — it will not
    // interrupt mid-sentence." One container, so it is announced ONCE: a
    // `role="status"` on each of the seven parts would read the finding out
    // seven times.
    expect({ file: card.file, statusContainers: status.length }).toEqual({
      file: card.file,
      statusContainers: 1,
    });
  });

  // -------------------------------------------------------------- §9 row 9
  test("every interactive control meets the 44px tap target through the shared primitive", () => {
    // CONTROLS.
    expect(offenders([PLANTED_INLINE_TAP], INLINE_TAP_TARGET)).not.toEqual([]);
    expect(offenders([CLEAN_SHARED_TAP], INLINE_TAP_TARGET)).toEqual([]);
    expect(INTERACTIVE.test(CLEAN_SHARED_TAP.source)).toBe(true);

    // LEG 1 — NO SEVENTH COPY. UX §5 is explicit: "extend the existing
    // `tapTargetStyle` convention (`workspace-name.tsx:17-22`) into a real
    // shared primitive rather than copying the object a seventh time." Six
    // copies is where a convention stops being one; the first-run tree adds
    // none.
    expect(offenders(readAll(FIRST_RUN_TREE), INLINE_TAP_TARGET)).toEqual([]);

    // LEG 2 — THERE IS EXACTLY ONE HOME, and this row discovers it rather than
    // pinning a path. **THE ADD DOES NOT NAME THE FILE**: §5's Wave 7 note
    // requires "one shared primitive" but no wave's exclusive file list carries
    // it, and `workspace-name.tsx` (which holds today's copy) is in no wave's
    // list either. Discovering the home keeps the row honest about what is
    // specified and what is not — and still fails if there are two homes.
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

    // EXPORTED, not merely declared. Today's copy in `workspace-name.tsx` is a
    // module-private `const` — which is why this row is red on this tree for a
    // reason that is not "the first-run tree is missing": the primitive has to
    // be extracted before anything can share it.
    expect({ file: home.file, exportedTapTargets: exported }).toEqual({
      file: home.file,
      exportedTapTargets: exported.length === 1 ? exported : [],
    });
    expect(exported).toHaveLength(1);

    // LEG 3 — every first-run component that renders a control uses it.
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
