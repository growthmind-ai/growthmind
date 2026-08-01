// THE SOURCE-SCAN SUBSTRATE FOR WAVE 0g. Not a suite — `bun test` never picks
// this file up, and nothing in production imports it.
//
// ###########################################################################
// # WHY FOUR SUITES SHARE ONE READER.
// #
// # AD-1 routes every structural UI contract to a source scan, because a scan
// # proves the invariant for EVERY FUTURE EDIT where a render test of today's
// # tree proves it only for today. That decision buys twenty-five rows across
// # four files, and every one of them has to answer the same two questions
// # first: WHICH files are the first-run tree, and WHAT does an absent one
// # mean.
// #
// # Four private answers to those two questions is the D11 duplication that
// # `module-under-construction.ts`'s own header exists to prevent, one level
// # out. So the manifest lives here once, and every read goes through
// # `readSourceUnderConstruction`, which turns an absent file into a NAMED
// # diagnostic stating the contract and naming the wave that owes it — never a
// # bare `ENOENT`, which reads as a broken checkout.
// ###########################################################################
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It holds no predicate that decides
// whether a row passes. Every scanner lives in the suite that asserts on it,
// beside its planted-offender and clean-fixture controls (ADD §9 standing rule
// 1) — a scanner separated from its controls is a scanner nobody can see is
// vacuous. What lives here is the plumbing underneath them: reading, walking,
// and separating what an author WROTE from what they SAID ABOUT it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readSourceUnderConstruction } from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";

/**
 * The repository root, derived from THIS FILE's own location.
 *
 * `apps/web/__tests__/first-run/helpers/` is five directories below the root.
 * If this file moves, this is the one line that moves with it.
 */
const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

// ===========================================================================
// The manifest — the first-run tree, exactly as ADD §5's ownership map states
// ===========================================================================

/** One file a Wave 7 agent owns, with the owner a red is allowed to name. */
export interface FirstRunFile {
  /** Repo-root-relative, WITH its extension — these are read, not resolved. */
  readonly repoRelativePath: string;
  /** The wave that creates it. Lands verbatim in the failure message. */
  readonly ownedBy: string;
}

const OWNER_7A = "ADD Wave 7a (frontend — the sequence, the forms, the receipt)";
const OWNER_7B = "ADD Wave 7b (frontend — the client, the strip, the stage, the styles)";

const entry = (repoRelativePath: string, ownedBy: string): FirstRunFile => ({
  repoRelativePath,
  ownedBy,
});

/** `StubStep.tsx` — the stub renderer. AD-19's `coming-next` arm, rendered. */
export const STUB_STEP = entry("apps/web/components/first-run/StubStep.tsx", OWNER_7A);

/** The live step's card. Named so `StubStep` can be asserted NOT to be one. */
export const STEP_ROW = entry("apps/web/components/first-run/StepRow.tsx", OWNER_7A);

/** AD-3's narrowed counter — its props type is the whole row. */
export const COUNTER_GRID = entry("apps/web/components/first-run/CounterGrid.tsx", OWNER_7A);

/** AD-5's consumer. It renders `reduceStage`'s output and derives nothing. */
export const STAGE = entry("apps/web/components/first-run/Stage.tsx", OWNER_7B);

/** The append-only log — the polite live region (UX §5's announcement table). */
export const WAIT_LOG = entry("apps/web/components/first-run/WaitLog.tsx", OWNER_7B);

/**
 * Step 3's card — the delivery step. Named because AD-6's wire test reads this
 * ONE file, and finding it by `.endsWith("ConnectSlackForm.tsx")` inside the
 * array below would be a second, private answer to "where does the delivery
 * card live" — the exact duplication this manifest exists to hold once.
 */
export const CONNECT_SLACK_FORM = entry(
  "apps/web/components/first-run/ConnectSlackForm.tsx",
  OWNER_7A,
);

/** The payoff. `role="status"`, announced once on arrival. */
export const FINDING_CARD = entry("apps/web/components/first-run/FindingCard.tsx", OWNER_7B);

/** The one stylesheet. B6, T1-T14 and the reduced-motion block all land here. */
export const FIRST_RUN_CSS = entry("apps/web/components/first-run/first-run.module.css", OWNER_7B);

/** The surface's server component — the preamble and the composition. */
export const FIRST_RUN_PAGE = entry("apps/web/app/(first-run)/first-run/page.tsx", OWNER_7A);

/**
 * The landing page. THE ONE MANIFEST FILE THAT EXISTS TODAY — Wave 7a edits it
 * rather than creating it, so a read here never fails for absence and the rows
 * that scan it are red on CONTENT. That is the honest shape of "the comment
 * must be UPDATED" and "the CTA must be GATED": both are claims about a file
 * that is already here and already says something else.
 */
export const LANDING_PAGE = entry("apps/web/app/page.tsx", OWNER_7A);

/** Every `.tsx` in the first-run component tree, both waves. */
export const FIRST_RUN_COMPONENTS: readonly FirstRunFile[] = [
  STUB_STEP,
  STEP_ROW,
  entry("apps/web/components/first-run/ConnectAnalyticsForm.tsx", OWNER_7A),
  COUNTER_GRID,
  entry("apps/web/components/first-run/PrivacyReceipt.tsx", OWNER_7A),
  CONNECT_SLACK_FORM,
  entry("apps/web/components/first-run/FirstRunClient.tsx", OWNER_7B),
  entry("apps/web/components/first-run/Strip.tsx", OWNER_7B),
  STAGE,
  WAIT_LOG,
  FINDING_CARD,
];

/** The route-tree files — the server page and its layout. */
export const FIRST_RUN_ROUTE_FILES: readonly FirstRunFile[] = [
  FIRST_RUN_PAGE,
  entry("apps/web/app/(first-run)/first-run/layout.tsx", OWNER_7A),
];

/** Every `.tsx` the surface is built from. The scan target for UX §5 and B6. */
export const FIRST_RUN_TREE: readonly FirstRunFile[] = [
  ...FIRST_RUN_COMPONENTS,
  ...FIRST_RUN_ROUTE_FILES,
];

// ===========================================================================
// Reading
// ===========================================================================

/** A source file that has been read, carrying where it came from. */
export interface ScannedFile {
  /** Repo-relative, so a failure names a path a reader can open. */
  readonly file: string;
  readonly source: string;
}

/**
 * Read one manifest file, or fail with the named Wave 0 diagnostic.
 *
 * NEVER `readFileSync` a manifest path directly. The whole first-run tree is
 * absent on the Wave 0 branch, and a bare `ENOENT` is indistinguishable from a
 * typo — the exact confusion `module-under-construction.ts` was written to
 * abolish.
 */
export function readFirstRun(file: FirstRunFile): ScannedFile {
  return {
    file: file.repoRelativePath,
    source: readSourceUnderConstruction({
      repoRelativePath: file.repoRelativePath,
      ownedBy: file.ownedBy,
    }),
  };
}

/** Read a manifest slice. The first absent file names its own owner. */
export function readAll(files: readonly FirstRunFile[]): readonly ScannedFile[] {
  return files.map((file) => readFirstRun(file));
}

/**
 * Read a file that ALREADY EXISTS on this tree — `globals.css`, `routes.ts`, a
 * walked production source. No under-construction wrapper, because absence here
 * really would be a broken checkout and should read as one.
 */
export function readExisting(repoRelativePath: string): ScannedFile {
  return {
    file: repoRelativePath,
    source: readFileSync(path.join(REPO_ROOT, repoRelativePath), "utf8"),
  };
}

// ===========================================================================
// Walking `apps/web` — for the two REPO-WIDE rows (AD-3, deviation 1)
// ===========================================================================

const WALK_SKIP = new Set(["node_modules", ".next", "dist", ".turbo"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * Every production `.ts`/`.tsx` under `apps/web`, repo-relative, sorted.
 *
 * **THE TEST TREE IS EXCLUDED, AND THAT IS A NAMED DEVIATION.** AD-3's row is
 * worded *"`expectedLag` appears nowhere under `apps/web`"* and deviation 1's
 * is *"no file under `apps/web/` … references `ROUTES.firstRun`"*. Read
 * literally, both are failed by the tests that FORBID those things — this suite
 * has to name the banned field to ban it, and Wave 0f's route suite names it
 * too. A guard that cannot be written without failing itself is not a guard.
 *
 * The scan is therefore over production source, which is where the invariant
 * bites: a component cannot render a field only a test file mentions.
 */
export function webSourceFiles(): readonly string[] {
  const root = path.join(REPO_ROOT, "apps", "web");
  const found: string[] = [];

  const walk = (absolute: string): void => {
    for (const item of readdirSync(absolute, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (WALK_SKIP.has(item.name) || item.name === "__tests__") continue;
        walk(path.join(absolute, item.name));
        continue;
      }
      if (SOURCE_EXTENSIONS.has(path.extname(item.name)))
        found.push(path.join(absolute, item.name));
    }
  };

  walk(root);

  return found
    .map((absolute) => path.relative(REPO_ROOT, absolute).split(path.sep).join("/"))
    .toSorted();
}

/** The walk, read. Used by the two repo-wide rows and nothing else. */
export function webSources(): readonly ScannedFile[] {
  return webSourceFiles().map((file) => readExisting(file));
}

// ===========================================================================
// Channels — what the author WROTE vs what they SAID ABOUT it
// ===========================================================================

type WalkState = "code" | "line" | "block" | "single" | "double" | "template";

interface Channels {
  /** The source with every COMMENT character replaced by a space. */
  readonly blanked: string;
  /** The source with every NON-comment character replaced by a space. */
  readonly comments: string;
}

/**
 * Split a TypeScript/TSX/CSS source into two same-length channels.
 *
 * A line-prefix heuristic fails in both directions on this codebase — the
 * lesson `packages/db/__tests__/schema/comment-truth.test.ts` already paid for
 * — so this is a character-state walk. Both channels keep the ORIGINAL LENGTH
 * and the original newlines, which is what lets a regex written the natural way
 * (`role="button"`, `aria-live="polite"`, `claude mcp`) run against either one
 * and still report a true line number.
 *
 * QUOTED STRING CONTENT STAYS IN `blanked`, DELIBERATELY. Customer copy lives
 * in quotes, `role="button"` lives in quotes, and an install command would live
 * in quotes. The channel that matters is comment-vs-not; a scanner that blanked
 * strings too would be blind to most of what this wave forbids.
 *
 * JSX TEXT ALSO STAYS IN `blanked`. `<Text>Not built yet.</Text>` is neither
 * quoted nor commented, and it is exactly the shape an inline sentence takes.
 */
function channels(source: string): Channels {
  const blanked: string[] = [];
  const comments: string[] = [];
  let state: WalkState = "code";

  const push = (ch: string, isComment: boolean): void => {
    if (ch === "\n") {
      blanked.push("\n");
      comments.push("\n");
      return;
    }
    blanked.push(isComment ? " " : ch);
    comments.push(isComment ? ch : " ");
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    const next = source[i + 1];

    if (ch === "\n") {
      push(ch, false);
      if (state === "line") state = "code";
      continue;
    }

    switch (state) {
      case "code": {
        if (ch === "/" && next === "/") {
          state = "line";
          push(" ", true);
          push(" ", true);
          i += 1;
        } else if (ch === "/" && next === "*") {
          state = "block";
          push(" ", true);
          push(" ", true);
          i += 1;
        } else {
          if (ch === '"') state = "double";
          else if (ch === "'") state = "single";
          else if (ch === "`") state = "template";
          push(ch, false);
        }
        break;
      }
      case "line": {
        push(ch, true);
        break;
      }
      case "block": {
        if (ch === "*" && next === "/") {
          push(" ", true);
          push(" ", true);
          state = "code";
          i += 1;
        } else push(ch, true);
        break;
      }
      case "single": {
        push(ch, false);
        if (ch === "\\") {
          const escaped = source[i + 1];
          if (escaped !== undefined) push(escaped, false);
          i += 1;
        } else if (ch === "'") state = "code";
        break;
      }
      case "double": {
        push(ch, false);
        if (ch === "\\") {
          const escaped = source[i + 1];
          if (escaped !== undefined) push(escaped, false);
          i += 1;
        } else if (ch === '"') state = "code";
        break;
      }
      case "template": {
        push(ch, false);
        if (ch === "\\") {
          const escaped = source[i + 1];
          if (escaped !== undefined) push(escaped, false);
          i += 1;
        } else if (ch === "`") state = "code";
        break;
      }
    }
  }

  return { blanked: blanked.join(""), comments: comments.join("") };
}

/**
 * The source with comments blanked out. **The default scan target** — a rule
 * about what a component RENDERS must never fire on the header explaining the
 * rule, and every file in this tree will have one.
 *
 * CSS `/* … *\/` comments are the same shape, so this works on the stylesheet
 * too; CSS has no `//` line comment, and a `//` inside a `url(//host)` would be
 * inside quotes here. `single`/`double` handle CSS strings identically.
 */
export function blankComments(source: string): string {
  return channels(source).blanked;
}

/** Everything the author SAID ABOUT the code, and nothing else. */
export function commentsOnly(source: string): string {
  return channels(source).comments;
}

// ===========================================================================
// Reporting
// ===========================================================================

/** Which channel a scan reads. Every caller states it, so none is implicit. */
export type Channel = "code" | "comments" | "raw";

const channelOf = (source: string, channel: Channel): string =>
  channel === "code"
    ? blankComments(source)
    : channel === "comments"
      ? commentsOnly(source)
      : source;

/**
 * Offenders as `path:line → text`, NEVER as a count.
 *
 * Every row in this wave fails at most once per sprint, in front of somebody
 * who did not write the offending line. A count tells them a rule exists; a
 * path and a line tells them where to go and fix it.
 */
export function offenders(
  files: readonly ScannedFile[],
  pattern: RegExp,
  channel: Channel = "code",
): readonly string[] {
  // A fresh RegExp per line, so a caller's `/g` flag cannot carry `lastIndex`
  // from one line into the next — a silent every-other-match bug that reports
  // half the offenders and reads as a pass.
  const flags = pattern.flags.replace("g", "");
  const found: string[] = [];

  for (const scanned of files) {
    const lines = channelOf(scanned.source, channel).split("\n");
    for (const [index, line] of lines.entries()) {
      if (new RegExp(pattern.source, flags).test(line)) {
        found.push(`${scanned.file}:${index + 1} → ${line.trim()}`);
      }
    }
  }

  return found;
}

/** True when ANY file matches. The `offenders` shape when the list is noise. */
export function anyMatch(
  files: readonly ScannedFile[],
  pattern: RegExp,
  channel: Channel = "code",
): boolean {
  return files.some((scanned) => pattern.test(channelOf(scanned.source, channel)));
}

/** A synthetic file, for the planted-offender and clean-fixture controls. */
export function fixture(name: string, source: string): ScannedFile {
  return { file: `apps/web/components/first-run/__${name}__.tsx`, source };
}

/**
 * The same, at a path the caller chooses.
 *
 * Needed because one scan in this wave — deviation 1's "nothing links back" —
 * decides by PATH, and `fixture()` puts its file inside the first-run tree,
 * which that scan exempts. A planted offender at an exempt path is a control
 * that cannot fail, which is the exact vacuity every control exists to rule
 * out.
 */
export function fixtureAt(repoRelativePath: string, source: string): ScannedFile {
  return { file: repoRelativePath, source };
}
