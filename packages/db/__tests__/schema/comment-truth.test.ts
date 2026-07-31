// The analysis schema's comment-truth guard (O-011 ADD v2 AD-25.3).
//
// WHAT THIS SUITE IS FOR, in one sentence: a header that names a column is
// making a checkable claim, and two retros in a row record headers that read
// false ON ARRIVAL — one naming a column that did not exist — so the claim gets
// checked by a machine rather than by eye.
//
// THE REFERENCES ARE RESOLVED AGAINST THE DRIZZLE TABLE OBJECTS, NEVER AGAINST
// A HAND-WRITTEN LIST OF NAMES. Every legitimate kind of backticked
// `snake_case` reference in these files resolves through something the schema
// itself declares — a column, a column's `enum` tuple, an index name, a table
// name in the barrel, or a `table.column` pair. That is what makes the guard
// survive a rename: rename a column and the resolver's vocabulary moves with
// it, so a header still naming the old name is the only thing left standing,
// and it fails here.
//
// Same shape as this codebase's proven answer to the false-claim defect class,
// the citation resolver at `packages/shared/__tests__/summary/
// assertion-contract.test.ts` — including its discipline that a reference which
// cannot be resolved is a FAILURE and never a skip. A skip would turn a false
// header into a green run, which is the exact thing this file exists to stop.
//
// WHY `node:fs` IS FINE HERE. `packages/core` holds a package-wide purity
// property over `src/` and keeps its suites on Bun APIs so they do not become
// the offender they police. `packages/db` has no such property and its
// structural suites already read source with `node:fs`
// (`__tests__/system/reachability.test.ts`). Nothing here is imported by
// production code.
//
// EVERY HELPER BELOW IS AT MODULE SCOPE, DELIBERATELY. A scanner declared
// inside a `test(...)` callback trips `unicorn/consistent-function-scoping`,
// which is the rule that turned this repository's suite red three sprints
// running.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import * as schema from "../../src/schema";
import { analysisModelCalls } from "../../src/schema/analysis-model-calls";
import { analysisRuns } from "../../src/schema/analysis-runs";
import { findings } from "../../src/schema/findings";

// --- the modules under scan -------------------------------------------------

/** A source file this guard reads, workspace-relative for failure messages. */
interface ScannedModule {
  readonly file: string;
  readonly source: string;
}

/** `packages/db/__tests__/schema/` → the schema file, two levels up. */
function readSchemaModule(basename: string): ScannedModule {
  const url = new URL(`../../src/schema/${basename}`, import.meta.url);
  return {
    file: `packages/db/src/schema/${basename}`,
    source: readFileSync(fileURLToPath(url), "utf8"),
  };
}

const FINDINGS_MODULE = readSchemaModule("findings.ts");

/** The three tables O-011 added. Their headers are what AD-25.3 polices. */
const SCANNED_MODULES: readonly ScannedModule[] = [
  FINDINGS_MODULE,
  readSchemaModule("analysis-model-calls.ts"),
  readSchemaModule("analysis-runs.ts"),
];

const SCANNED_CONFIGS = [findings, analysisModelCalls, analysisRuns].map((table) =>
  getTableConfig(table),
);

// --- extracting the comments ------------------------------------------------

/** One physical line's worth of comment text. */
interface CommentLine {
  readonly text: string;
  readonly line: number;
}

/**
 * Every COMMENT character in a TypeScript source, one entry per physical line.
 *
 * A character-level walk rather than a line-prefix heuristic, because the
 * heuristic fails in BOTH directions on this codebase: a trailing
 * `// see \`foo_bar\`` on a code line would be missed, and
 * `sql\`${'$'}{table.status} = 'running'\`` (`analysis-runs.ts`) is a template
 * literal in CODE whose contents must never be read as a claim. String,
 * template and comment states are tracked so neither happens.
 */
function commentLines(source: string): readonly CommentLine[] {
  const lines: CommentLine[] = [];
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  let buffer = "";
  let line = 1;

  const flush = (): void => {
    if (buffer.trim().length > 0) lines.push({ text: buffer, line });
    buffer = "";
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\n") {
      flush();
      line += 1;
      if (state === "line") state = "code";
      continue;
    }

    switch (state) {
      case "code": {
        if (ch === "/" && next === "/") {
          state = "line";
          i += 1;
        } else if (ch === "/" && next === "*") {
          state = "block";
          i += 1;
        } else if (ch === '"') state = "double";
        else if (ch === "'") state = "single";
        else if (ch === "`") state = "template";
        break;
      }
      case "line": {
        buffer += ch;
        break;
      }
      case "block": {
        if (ch === "*" && next === "/") {
          flush();
          state = "code";
          i += 1;
        } else buffer += ch;
        break;
      }
      // A string or template literal in CODE contributes nothing. Escapes are
      // skipped so a closing quote inside one cannot end the literal early.
      case "single": {
        if (ch === "\\") i += 1;
        else if (ch === "'") state = "code";
        break;
      }
      case "double": {
        if (ch === "\\") i += 1;
        else if (ch === '"') state = "code";
        break;
      }
      case "template": {
        if (ch === "\\") i += 1;
        else if (ch === "`") state = "code";
        break;
      }
    }
  }

  flush();
  return lines;
}

/** The `*` gutter a block comment's continuation lines carry. */
const COMMENT_GUTTER = /^\s*\*+ ?/;

/**
 * A run of CONSECUTIVE comment lines, joined into one string.
 *
 * Joined rather than scanned line by line because this codebase wraps prose at
 * 80 columns and a backticked citation legitimately straddles the wrap
 * (`analysis-runs.ts:11-12`). Pairing backticks per line would mis-pair every
 * later backtick on those lines — a scanner reporting confidently on text it
 * parsed wrong is worse than one that reports nothing.
 */
interface CommentSegment {
  readonly text: string;
  /** `lineOf[i]` is the source line the character at `text[i]` came from. */
  readonly lineOf: readonly number[];
}

function commentSegments(source: string): readonly CommentSegment[] {
  const segments: { text: string; lineOf: number[] }[] = [];
  let current: { text: string; lineOf: number[] } | undefined;
  let previousLine = Number.NEGATIVE_INFINITY;

  for (const { text, line } of commentLines(source)) {
    const stripped = text.replace(COMMENT_GUTTER, "");

    if (current === undefined || line !== previousLine + 1) {
      current = { text: "", lineOf: [] };
      segments.push(current);
    } else {
      // The wrap itself becomes a space, so two halves of a wrapped citation
      // are one backticked span but never one token.
      current.text += " ";
      current.lineOf.push(line);
    }

    current.text += stripped;
    for (let i = 0; i < stripped.length; i += 1) current.lineOf.push(line);
    previousLine = line;
  }

  return segments;
}

// --- deciding what is a column reference ------------------------------------

const BACKTICK_QUOTED = /`([^`]+)`/g;

/**
 * Anything that cannot be part of an identifier, a `table.column` pair, or a
 * path. Paths keep their `/` and `-` on purpose — that is what lets the file
 * test below reject `packages/db/src/schema/deliveries.ts` whole, instead of
 * shredding it into a `deliveries.ts` that reads like a table-qualified name.
 */
const TOKEN_SEPARATORS = /[^A-Za-z\d_./\\-]+/;

/** A lowercase identifier: a single word, or `snake_case`. */
const IDENTIFIER = /^[a-z][a-z\d]*(?:_[a-z\d]+)*$/;

/** The same, but with at least one underscore — the shape a column has. */
const SNAKE_CASE = /^[a-z][a-z\d]*(?:_[a-z\d]+)+$/;

/**
 * A path or a filename, which is never a column reference. Necessary because
 * several tables share a stem with the file that declares them
 * (`deliveries.ts:95-97` is cited by `findings.ts`), and a filename is a claim
 * these headers make constantly and legitimately.
 */
const FILE_LIKE = /[/\\-]|\.(?:ts|tsx|js|mjs|cjs|json|sql|md|ya?ml|env|example|txt)$/;

/** Every table in the Drizzle barrel, by its DB name, with its column names. */
const COLUMNS_BY_TABLE: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  // The barrel exports relations as well as tables, so `is` is the filter —
  // there is no hand-maintained list of table names anywhere in this file.
  Object.values(schema).flatMap((value) => {
    if (!is(value, PgTable)) return [];
    const config = getTableConfig(value);
    return [[config.name, new Set(config.columns.map((column) => column.name))] as const];
  }),
);

/**
 * True when a token is claiming to name a column at all.
 *
 * Unqualified, it must be `snake_case` — an unqualified single word is not
 * distinguishable from an English one, and AD-25.3 asks for column references.
 * Qualified `a.b`, it must read as TABLE-qualified: either a table that exists
 * (so `findings.no_such_column` is judged), or a `snake_case` prefix that no
 * table has (so a renamed table is judged too). `types.ts` and `z.number()`
 * fall out of both, which is why they are not reported.
 */
function isColumnReference(token: string): boolean {
  if (FILE_LIKE.test(token)) return false;

  const dot = token.indexOf(".");
  if (dot === -1) return SNAKE_CASE.test(token);

  const prefix = token.slice(0, dot);
  const suffix = token.slice(dot + 1);
  if (!IDENTIFIER.test(prefix) || !IDENTIFIER.test(suffix)) return false;

  return COLUMNS_BY_TABLE.has(prefix) || SNAKE_CASE.test(prefix);
}

/** A backticked column reference, with where it was written. */
interface CommentReference {
  readonly token: string;
  readonly file: string;
  readonly line: number;
}

/** Every column reference a module's comments make. */
function commentReferences(module: ScannedModule): readonly CommentReference[] {
  const references: CommentReference[] = [];

  for (const segment of commentSegments(module.source)) {
    for (const quoted of segment.text.matchAll(BACKTICK_QUOTED)) {
      // The line of the OPENING backtick — where a reader would go to fix it.
      const line = segment.lineOf[quoted.index ?? 0] ?? 0;

      for (const token of quoted[1].split(TOKEN_SEPARATORS)) {
        if (isColumnReference(token)) references.push({ token, file: module.file, line });
      }
    }
  }

  return references;
}

// --- resolving a reference against the schema -------------------------------

/** Columns of the three tables under scan. */
const SCANNED_COLUMNS: ReadonlySet<string> = new Set(
  SCANNED_CONFIGS.flatMap((config) => config.columns.map((column) => column.name)),
);

/**
 * Members of those tables' `text(…, { enum })` tuples — `cap_exhausted`,
 * `floor_cap_exhausted`, `no_sessions_to_analyse` and the rest. They read
 * exactly like column names and the schema itself declares them, so they are
 * resolved off the column objects rather than listed by hand.
 */
const SCANNED_ENUM_MEMBERS: ReadonlySet<string> = new Set(
  SCANNED_CONFIGS.flatMap((config) =>
    config.columns.flatMap((column) => [...(column.enumValues ?? [])]),
  ),
);

/** Index names those tables declare — `findings_org_project_signature_key`. */
const SCANNED_INDEXES: ReadonlySet<string> = new Set(
  SCANNED_CONFIGS.flatMap((config) => config.indexes.map((index) => index.config.name ?? "")),
);

/**
 * The residue: backticked `snake_case` that is legitimately NOT resolvable from
 * the schema. Kept explicit, kept tiny, and every entry states why — a
 * catch-all here would quietly turn this whole suite into decoration. A test
 * below fails if an entry stops being referenced, so the list cannot rot.
 */
const NON_COLUMN_ALLOWLIST: Readonly<Record<string, string>> = {
  // A table this repository DELIBERATELY does not have. `findings.ts`'s header
  // names it to explain why the delivery wire is cut (AD-12): the poster would
  // be built from a `slack_connections` row that does not exist. If this one
  // ever resolved, the deferral would have been built without the header being
  // told, which is the same class of false claim in the other direction.
  slack_connections:
    "the deliberately-absent delivery table, named by findings.ts to explain the cut wire (AD-12)",
  // A `ClaimModelCallResult` discriminant, not a stored value. It lives on the
  // repository's return type (`analysis-runs.repo.ts`) and the cap ledger's
  // header names it because the two refusals must never collapse. Nothing
  // persists it, so no column and no column enum can carry it.
  already_claimed:
    "a ClaimModelCallResult refusal member on analysis-runs.repo.ts, never a persisted value",
};

/**
 * True when a reference names something the schema actually declares.
 *
 * The ladder, in order: a qualified `table.column` pair resolved in the barrel;
 * a column of one of the three scanned tables; a table name; one of those
 * tables' column enum members; one of their index names; and last the two
 * justified non-schema entries above.
 *
 * A qualified reference whose table is unknown resolves to FALSE rather than
 * falling through to the unqualified rungs — `no_such_table.signature` must
 * fail even though `signature` exists somewhere.
 */
function resolvesAgainstTheSchema(token: string): boolean {
  const dot = token.indexOf(".");
  if (dot !== -1) {
    const columns = COLUMNS_BY_TABLE.get(token.slice(0, dot));
    return columns?.has(token.slice(dot + 1)) ?? false;
  }

  return (
    SCANNED_COLUMNS.has(token) ||
    COLUMNS_BY_TABLE.has(token) ||
    SCANNED_ENUM_MEMBERS.has(token) ||
    SCANNED_INDEXES.has(token) ||
    Object.hasOwn(NON_COLUMN_ALLOWLIST, token)
  );
}

/** Formatted so a failure names the file and line, never just a count. */
function unresolvedIn(modules: readonly ScannedModule[]): readonly string[] {
  return modules
    .flatMap((module) => commentReferences(module))
    .filter((reference) => !resolvesAgainstTheSchema(reference.token))
    .map((reference) => `${reference.file}:${reference.line} → \`${reference.token}\``);
}

// --- the synthetic fixtures that prove the scanner bites --------------------

/**
 * A module that is not in the tree, carrying planted offenders beside real
 * references. Its job is to FAIL — an assertion that cannot fail proves
 * nothing, and this one runs before anything is claimed about the real files.
 */
const PLANTED_OFFENDER: ScannedModule = {
  file: "packages/db/src/schema/__synthetic__.ts",
  source: [
    "/**",
    " * A header naming `no_such_column_anywhere`, which nothing declares.",
    " * It also cites `findings.no_such_column` on a table that IS real,",
    " * and `no_such_table.signature` on a table that is not.",
    " */",
    "export const planted = sql`${table.not_a_comment_column} = 1`; // in CODE",
  ].join("\n"),
};

/** The same shape with every reference true — the control for the above. */
const CLEAN_FIXTURE: ScannedModule = {
  file: "packages/db/src/schema/__synthetic_clean__.ts",
  source: [
    "/**",
    " * `signature_version` is a column, `signature_ancestry` is a table,",
    " * `cap_exhausted` is a stop reason, `finding_signatures.signature_tuple_version`",
    " * is a qualified pair, and `findings_org_project_signature_key` is an index.",
    " * `slack_connections` is the one allow-listed absence, and this cites",
    " * `packages/db/src/schema/deliveries.ts:95-97`, which is a path and not a claim.",
    " */",
  ].join("\n"),
};

/** The column reference the rename drill below mutates. */
const DRILLED_COLUMN = "resolved_model_id";
const DRILLED_RENAME = "resolved_model_ident";

/**
 * The REAL `findings.ts`, with one column reference in its prose renamed to a
 * name no table has.
 *
 * This is the AD-20 scenario reproduced exactly — a column renamed, a header
 * left behind — run against real source rather than a toy fixture, so the
 * guard cannot read as proven merely because a hand-written fixture was easy
 * to catch. The file on disk is never touched.
 */
const RENAME_DRILL: ScannedModule = {
  file: "packages/db/src/schema/findings.ts",
  source: FINDINGS_MODULE.source.replaceAll(`\`${DRILLED_COLUMN}\``, `\`${DRILLED_RENAME}\``),
};

describe("the analysis schema's comment-truth guard", () => {
  test("the comment scanner bites on a planted reference no table declares", () => {
    // NON-VACUITY, BEFORE ANY CLAIM ABOUT THE REAL MODULES. A scanner that
    // extracted nothing, or a resolver that said yes to everything, would make
    // the suite below pass over an empty set and report green.
    expect(unresolvedIn([PLANTED_OFFENDER])).toEqual([
      "packages/db/src/schema/__synthetic__.ts:2 → `no_such_column_anywhere`",
      "packages/db/src/schema/__synthetic__.ts:3 → `findings.no_such_column`",
      "packages/db/src/schema/__synthetic__.ts:4 → `no_such_table.signature`",
    ]);

    // The template literal on the fixture's last line is CODE, not a claim. If
    // the scanner read it, the header of any file using `sql` would be judged
    // on text its author never wrote as a statement.
    const scanned = commentReferences(PLANTED_OFFENDER).map((reference) => reference.token);
    expect(scanned).not.toContain("not_a_comment_column");

    // ...and the control, so the guard is not simply always-unresolved: a
    // fixture of the same shape whose every reference is true reports nothing.
    expect(unresolvedIn([CLEAN_FIXTURE])).toEqual([]);
    // Vacuously empty would pass that too, so prove the control was read.
    expect(commentReferences(CLEAN_FIXTURE).map((reference) => reference.token)).toEqual([
      "signature_version",
      "signature_ancestry",
      "cap_exhausted",
      "finding_signatures.signature_tuple_version",
      "findings_org_project_signature_key",
      "slack_connections",
    ]);
  });

  test("the guard bites on real source when a column is renamed out from under a header", () => {
    // The drill must have changed something, or it proves nothing at all.
    expect(RENAME_DRILL.source).not.toBe(FINDINGS_MODULE.source);
    expect(SCANNED_COLUMNS.has(DRILLED_COLUMN)).toBe(true);
    expect(SCANNED_COLUMNS.has(DRILLED_RENAME)).toBe(false);

    const reported = unresolvedIn([RENAME_DRILL]);

    expect(reported.length).toBeGreaterThan(0);
    for (const entry of reported) expect(entry).toContain(`\`${DRILLED_RENAME}\``);

    // The unmutated file is the same read through the same pipeline, and it is
    // clean — so the report above is the rename, not a scanner that always
    // complains about `findings.ts`.
    expect(unresolvedIn([FINDINGS_MODULE])).toEqual([]);
  });

  test("every column named in the analysis schema comments resolves to a real column", () => {
    // The scanner must actually be looking at something: three real modules,
    // and a non-trivial number of references extracted from them.
    expect(SCANNED_MODULES.length).toBe(3);

    const references = SCANNED_MODULES.flatMap((module) => commentReferences(module));
    expect(references.length).toBeGreaterThan(20);

    // Reported as `file:line → token`, never as a count: a failure here must
    // name the header that went false and where to go and fix it.
    expect(unresolvedIn(SCANNED_MODULES)).toEqual([]);
  });

  test("every comment segment the scanner reads has balanced backticks", () => {
    // The extractor pairs backticks within a joined RUN of comment lines. An
    // odd count means a quoted reference was never closed, which would
    // mis-pair every later backtick in that run.
    const unbalanced = SCANNED_MODULES.flatMap((module) =>
      commentSegments(module.source)
        .filter((segment) => (segment.text.match(/`/g) ?? []).length % 2 !== 0)
        .map((segment) => `${module.file}:${segment.lineOf[0] ?? 0}`),
    );

    expect(unbalanced).toEqual([]);
  });

  test("every allow-listed non-column is still referenced and still justified", () => {
    // An allow-list that outlives its references is how a guard decays into a
    // catch-all. Each entry must earn its place on every run.
    const referenced = new Set(
      SCANNED_MODULES.flatMap((module) => commentReferences(module)).map(
        (reference) => reference.token,
      ),
    );

    for (const [token, why] of Object.entries(NON_COLUMN_ALLOWLIST)) {
      expect(referenced.has(token)).toBe(true);
      expect(why.trim().length).toBeGreaterThan(0);

      // And it must not be a real column or table that was listed by mistake —
      // an entry that would resolve anyway is a rung nobody needs.
      expect(SCANNED_COLUMNS.has(token)).toBe(false);
      expect(COLUMNS_BY_TABLE.has(token)).toBe(false);
    }
  });
});
