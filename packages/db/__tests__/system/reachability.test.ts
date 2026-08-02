import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import * as dbBarrel from "../../src/index";
import {
  claimDuePollableConnections,
  readConnectionCredential,
  systemTenantContextFor,
  SYSTEM_ACTOR,
  type PollableConnection,
} from "../../src/system";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const NAMES = laneNames("sys");

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".ai",
  ".claude",
  "tasks",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

// Item 83's detector as a pure function over (path, source) pairs, so the real tree and the
// planted fixtures below go through exactly one code path.

interface ScannedSource {
  readonly path: string;
  readonly source: string;
}

const fixture = (filePath: string, source: string): ScannedSource => ({ path: filePath, source });

const TEST_DIRS = new Set(["__tests__"]);

const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

// Deliberately tighter than item 84's `rel.includes(".test.")`, which also swallows a real
// production `my.test.helper.ts`. An exclusion on this gate may only ever get narrower.
function isTestPath(rel: string): boolean {
  const segments = rel.split("/");
  const name = segments.pop() ?? "";
  return (
    segments.some((segment) => TEST_DIRS.has(segment)) ||
    TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

const SYSTEM_IMPORT_PATTERNS = [
  /["']@growthmind\/db\/system["']/,
  /["'][^"']*packages\/db\/src\/system[^"']*["']/,
];

const importsSystemModule = (source: string): boolean =>
  SYSTEM_IMPORT_PATTERNS.some((pattern) => pattern.test(source));

// Every PRODUCTION file in `files` that reaches the system module, by path.
const systemImportOffenders = (files: readonly ScannedSource[]): readonly string[] =>
  files
    .filter((file) => !isTestPath(file.path) && importsSystemModule(file.source))
    .map((file) => file.path);

// The realistic offending edit: a route reaching for the one function that already returns
// the org list. It resolves, typechecks, lints and ships, and must be caught by its subpath.
const PLANTED_PRODUCTION_IMPORT = fixture(
  "apps/web/app/api/first-run/slack/status/route.ts",
  `import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";

export async function GET() {
  return Response.json(await listOrgsWithActiveSlackConnection(db));
}
`,
);

// The same offence routed around the package boundary — the SECOND pattern in
// `SYSTEM_IMPORT_PATTERNS`, which a control exercising only the first leaves free to rot.
const PLANTED_PRODUCTION_RELATIVE_IMPORT = fixture(
  "apps/web/lib/first-run/status.ts",
  `import { systemContextFor } from "../../../../packages/db/src/system/system-actor";
`,
);

// The real shape of the file that forced the narrowing: a suite under `__tests__/` importing
// the system module for a fixture. Must NOT be caught — this is what makes the exclusion tested.
const CLEAN_TEST_DIR_IMPORT = fixture(
  "apps/web/__tests__/first-run/nullable-channel-readers.test.ts",
  `import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";
`,
);

// The same, colocated rather than under `__tests__/` — the suffix leg.
const CLEAN_COLOCATED_TEST_IMPORT = fixture(
  "apps/web/lib/first-run/status.spec.ts",
  `import { systemContextFor } from "../../../../packages/db/src/system/system-actor";
`,
);

// A production file importing the SCOPED barrel. Not caught — otherwise the detector matches
// "db" rather than "the system subpath" and every row reports an ordinary import as a breach.
const CLEAN_PRODUCTION_IMPORT = fixture(
  "apps/web/lib/first-run/status.ts",
  `import { createSlackConnectionsRepo } from "@growthmind/db";
`,
);

describe("system subpath unreachability", () => {
  // Item 83. `packages/db/src/system/` mints a `TenantContext` for any organization with no
  // user present, so a production import under `apps/` is a D7 bypass that typechecks, lints
  // and ships. THE SCAN IS PRODUCTION-ONLY ON PURPOSE: a file under `__tests__/` or named
  // `*.test.ts`/`*.spec.ts` is not bundled, is reachable from no route, and receives no
  // request — a suite reaching for the system module exercises the boundary rather than
  // crossing it. Those two exclusions are the floor, not a precedent. Both controls assert
  // before any claim about the real tree; without them a broken regex reports green forever.
  it("has no production file under apps/ importing the db system module", () => {
    // Positive controls: the detector fires on a shipped file, by subpath and by deep path.
    expect(systemImportOffenders([PLANTED_PRODUCTION_IMPORT])).toEqual([
      "apps/web/app/api/first-run/slack/status/route.ts",
    ]);
    expect(systemImportOffenders([PLANTED_PRODUCTION_RELATIVE_IMPORT])).toEqual([
      "apps/web/lib/first-run/status.ts",
    ]);

    // Clean controls: the same import under a test path is not an offence — by directory and
    // by suffix — and the detector is about the SUBPATH, not about importing the db.
    expect(systemImportOffenders([CLEAN_TEST_DIR_IMPORT])).toEqual([]);
    expect(systemImportOffenders([CLEAN_COLOCATED_TEST_IMPORT])).toEqual([]);
    expect(systemImportOffenders([CLEAN_PRODUCTION_IMPORT])).toEqual([]);

    const scanned: ScannedSource[] = listSourceFiles(path.join(REPO_ROOT, "apps")).map((file) => ({
      path: relative(file),
      source: readFileSync(file, "utf8"),
    }));

    // The scan must see the web app, or the assertion is vacuous.
    expect(scanned.length).toBeGreaterThan(0);

    const production = scanned.filter((file) => !isTestPath(file.path));

    // ...and must still see it after the exclusion, which must itself ENGAGE on the real tree:
    // if `relative()` stopped normalising Windows separators the exclusion would be inert.
    expect(production.length).toBeGreaterThan(0);
    expect(production.length).toBeLessThan(scanned.length);

    expect(systemImportOffenders(scanned)).toEqual([]);
  });

  const ACTOR_VOCABULARY = [/\bsystemContextFor\b/, /\bSYSTEM_ACTOR\b/, /\bSYSTEM_ACTOR_ROLE\b/];

  it("names the scheduled-actor vocabulary only under the db system module, the worker, and tests", () => {
    const roots = ["apps", "packages", "worker", "scripts"].map((dir) => path.join(REPO_ROOT, dir));
    const files = roots.flatMap((root) => listSourceFiles(root));
    expect(files.length).toBeGreaterThan(0);

    const allowed = (file: string): boolean => {
      const rel = relative(file);
      return (
        rel.startsWith("packages/db/src/system/") ||
        rel.startsWith("worker/") ||
        rel.includes("__tests__/") ||
        rel.includes(".test.") ||
        rel.includes(".spec.")
      );
    };

    const offenders = files.filter((file) => {
      if (allowed(file)) return false;
      const source = readFileSync(file, "utf8");
      return ACTOR_VOCABULARY.some((pattern) => pattern.test(source));
    });

    expect(offenders.map(relative)).toEqual([]);
  });

  it("finds the guarded vocabulary in the module it is meant to contain", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "packages", "db", "src", "system", "system-actor.ts"),
      "utf8",
    );

    for (const pattern of ACTOR_VOCABULARY) {
      expect(source).toMatch(pattern);
    }
  });

  it("exports none of the four system functions from the main db barrel", () => {
    const exported = Object.keys(dbBarrel);

    expect(exported).not.toContain("claimDuePollableConnections");
    expect(exported).not.toContain("readConnectionCredential");
    expect(exported).not.toContain("systemTenantContextFor");
    expect(exported).not.toContain("listAnalysableProjects");
    expect(exported).not.toContain("SYSTEM_ACTOR");
    expect(exported).not.toContain("systemContextFor");

    expect(exported).toContain("createProjectConnectionsRepo");
    expect(exported).toContain("createSessionsRepo");
  });

  it("does not re-export src/system from src/index.ts", () => {
    const barrel = readFileSync(path.join(REPO_ROOT, "packages", "db", "src", "index.ts"), "utf8");
    const withoutComments = barrel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

    expect(withoutComments).not.toMatch(/from\s+["']\.\/system/);
  });
});

describe("system reads carry no credential and no id-only path", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("declares no credential-bearing field on PollableConnection", () => {
    type CredentialBearing =
      | "credential"
      | "credentialCiphertext"
      | "credentialKeyId"
      | "personalApiKey"
      | "apiKey"
      | "secret";
    type AssertNever<T extends never> = T;
    type CredentialKeysOnPollableConnection = AssertNever<
      Extract<keyof PollableConnection, CredentialBearing>
    >;

    const witness: CredentialKeysOnPollableConnection[] = [];
    expect(witness).toEqual([]);
  });

  it("returns no credential-bearing field on a really claimed connection", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("no-credential"),
      userName: NAMES.userName("no-credential"),
      email: NAMES.email("no-credential"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("no-credential"),
    });
    const seeded = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      nextPollAt: new Date("2026-07-30T11:59:00.000Z"),
    });

    const claimed = await claimDuePollableConnections(db, {
      now: new Date("2026-07-30T12:00:00.000Z"),
      limit: 10,
    });
    const mine = claimed.find((row) => row.id === seeded.id);
    expect(mine).toBeDefined();

    const keys = Object.keys(mine as object);
    expect(keys.filter((key) => /credential|secret|token|api_?key|password/i.test(key))).toEqual(
      [],
    );

    expect(JSON.stringify(mine)).not.toContain("v1.00000000");

    const ctx = systemTenantContextFor(mine as PollableConnection);
    expect(ctx.userId).toBe(SYSTEM_ACTOR.SESSION_SOURCE_POLL);
    expect(ctx.organizationId).toBe(org.organizationId);
  });

  it("requires the owning organization id to read a credential — there is no id-only path", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("credential-a"),
      userName: NAMES.userName("credential-a"),
      email: NAMES.email("credential-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("credential-b"),
      userName: NAMES.userName("credential-b"),
      email: NAMES.email("credential-b"),
    });
    const project = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: NAMES.projectName("credential"),
    });
    const connection = await seedConnection(db, {
      organizationId: orgA.organizationId,
      projectId: project.id,
    });

    const mine = await readConnectionCredential(db, {
      connectionId: connection.id,
      organizationId: orgA.organizationId,
    });
    expect(mine?.ciphertext).toBe("v1.00000000.aaaa.bbbb.cccc");
    expect(mine?.keyId).toBe("00000000");

    expect(
      await readConnectionCredential(db, {
        connectionId: connection.id,
        organizationId: orgB.organizationId,
      }),
    ).toBeNull();
  });

  it("accepts the organization id as a required parameter on readConnectionCredential", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "packages", "db", "src", "system", "pollable-connections.ts"),
      "utf8",
    );
    const signature = /readConnectionCredential\s*\(([\s\S]*?)\)\s*:/.exec(source);
    expect(signature).not.toBeNull();
    expect(signature?.[1]).toMatch(/organizationId\s*:\s*string/);

    expect(signature?.[1]).not.toMatch(/organizationId\s*\?/);
  });
});
