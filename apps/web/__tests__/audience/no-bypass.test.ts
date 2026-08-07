// D7 structural half for ADD O-036 AD-5: every audience read goes through
// createGrowthContextRepo under the caller's tenant context, so the read path may hold no
// hand-written query. Red at Wave 0 because none of the three files exist yet; Waves 4/7
// create them and this turns green only if they arrive clean.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const AUDIENCE_PAGE = {
  rel: "app/(app)/audience/page.tsx",
  abs: path.join(WEB_ROOT, "app", "(app)", "audience", "page.tsx"),
} as const;

const GUARDED: readonly { readonly rel: string; readonly abs: string }[] = [
  { rel: "lib/audience/read.ts", abs: path.join(WEB_ROOT, "lib", "audience", "read.ts") },
  { rel: "lib/audience/kinds.ts", abs: path.join(WEB_ROOT, "lib", "audience", "kinds.ts") },
  AUDIENCE_PAGE,
];

const DRIZZLE_IMPORT = /from\s+["']drizzle-orm/;
const SQL_TAG = /\bsql`/;

// `@growthmind/db` exports `schema`, and the client is built with it, so
// `db.query.growthContext.findFirst(...)` is a working unscoped read that imports no
// drizzle-orm and tags no sql template. Both scans above stay silent on it; these two do not.
const DB_QUERY = /\bdb\.query\./;
const SCHEMA_IMPORT = /import\s*\{[^}]*\bschema\b[^}]*\}\s*from\s+["']@growthmind\/db["']/;

// Four negatives can all hold on a page that reads nothing at all, so the page must also be
// caught doing it the one permitted way.
const REPO_CALL = /createGrowthContextRepo\(/;

function sourceOf(file: { readonly rel: string; readonly abs: string }): string {
  if (!existsSync(file.abs)) {
    throw new Error(
      `apps/web/${file.rel} does not exist yet (expected at ${file.abs}) — the audience read ` +
        `path (ADD O-036 AD-5/AD-6) has not been built. This is a Wave 0 red for the RIGHT reason.`,
    );
  }
  return readFileSync(file.abs, "utf8");
}

describe("the audience read path contains no hand-written query (D7)", () => {
  test("CONTROL: every scan catches its offender and clears its safe neighbour", () => {
    expect(DRIZZLE_IMPORT.test('import { eq } from "drizzle-orm";')).toBe(true);
    expect(DRIZZLE_IMPORT.test('import { and, eq } from "drizzle-orm/pg-core";')).toBe(true);
    expect(DRIZZLE_IMPORT.test('import { createGrowthContextRepo } from "@growthmind/db";')).toBe(
      false,
    );

    expect(SQL_TAG.test("await db.execute(sql`select 1`);")).toBe(true);
    expect(SQL_TAG.test('const label = "sql";')).toBe(false);

    expect(DB_QUERY.test("await db.query.growthContext.findFirst({ where });")).toBe(true);
    expect(DB_QUERY.test("await getDb().query.projects.findMany();")).toBe(false);
    expect(DB_QUERY.test("const rows = await repo.query(projectId);")).toBe(false);

    expect(SCHEMA_IMPORT.test('import { schema } from "@growthmind/db";')).toBe(true);
    expect(
      SCHEMA_IMPORT.test('import { createGrowthContextRepo, schema } from "@growthmind/db";'),
    ).toBe(true);
    expect(
      SCHEMA_IMPORT.test(
        'import {\n  createGrowthContextRepo,\n  schema,\n} from "@growthmind/db";',
      ),
    ).toBe(true);
    expect(
      SCHEMA_IMPORT.test(
        'import { createGrowthContextRepo, ensureProject } from "@growthmind/db";',
      ),
    ).toBe(false);
    expect(SCHEMA_IMPORT.test('import { growthContextSchema } from "@growthmind/core";')).toBe(
      false,
    );

    expect(REPO_CALL.test("createGrowthContextRepo(db, ctx).readBusinessResearch(projectId)")).toBe(
      true,
    );
    expect(REPO_CALL.test("// createGrowthContextRepo is the only door into that row")).toBe(false);
  });

  for (const file of GUARDED) {
    test(`${file.rel} holds no hand-written read of the growth context row`, () => {
      const source = sourceOf(file);

      expect(source).not.toMatch(DRIZZLE_IMPORT);
      expect(source).not.toMatch(SQL_TAG);
      expect(source).not.toMatch(DB_QUERY);
      expect(source).not.toMatch(SCHEMA_IMPORT);
    });
  }

  test(`${AUDIENCE_PAGE.rel} reads through the repository rather than around it`, () => {
    expect(sourceOf(AUDIENCE_PAGE)).toMatch(REPO_CALL);
  });
});
