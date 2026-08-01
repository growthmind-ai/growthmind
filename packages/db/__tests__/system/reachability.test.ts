// Wave 0b, lane L3, fixture seed prefix `db-`. Add
// tasks/session-source-posthog-adapter/add.md items 83–87, / /.
//
// asks for a stated mechanism plus a proof of unreachability. The mechanism is the
// `"./system"` subpath: `src/system/` is absent from the main barrel, so a web-app
// import of it is a single greppable line. This file is what turns that convention into
// a gate.
//
// Items 83–85 are structural invariants over source, so they hold against the Wave 0a
// scaffold already and are guardrails rather than red tests. Their job starts the
// moment someone wires the worker up and reaches for a shortcut. Items 86–87 are
// behavioural and fail on the typed stubs.
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

// ===========================================================================
// Item 83's detector, as a pure function over (path, source) pairs
//
// Lifted out of the row so the REAL tree and the PLANTED FIXTURES below go
// through exactly one code path. A detector that fixtures exercise separately
// from the files it is meant to police proves nothing about the files.
// ===========================================================================

/** A file the detector can be run against — a real one, or a planted fixture. */
interface ScannedSource {
  /** Repo-relative, forward slashes: exactly what `relative()` produces. */
  readonly path: string;
  readonly source: string;
}

const fixture = (filePath: string, source: string): ScannedSource => ({ path: filePath, source });

/**
 * Directory segments whose contents are never shipped.
 *
 * Same shape as `SKIP_DIRS` above — a set of path segments matched by name —
 * deliberately, so this file has exactly one way of saying "not production"
 * rather than two mechanisms that can drift apart.
 */
const TEST_DIRS = new Set(["__tests__"]);

/** Suffixes that make a file a test wherever it sits, colocated or not. */
const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

/**
 * Deliberately tighter than item 84's `allowed()`, which uses
 * `rel.includes(".test.")`. A substring match also swallows
 * `lib/first-run/my.test.helper.ts` — a real production file with an unlucky
 * name. An exclusion that decides what this gate is allowed to see may only
 * ever get narrower.
 */
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

/** Every PRODUCTION file in `files` that reaches the system module, by path. */
const systemImportOffenders = (files: readonly ScannedSource[]): readonly string[] =>
  files
    .filter((file) => !isTestPath(file.path) && importsSystemModule(file.source))
    .map((file) => file.path);

// ---------------------------------------------------------------------------
// The controls — a planted offender and a clean fixture, per leg
// ---------------------------------------------------------------------------

/**
 * THE OFFENDER IS THE REALISTIC EDIT. A route handler that needs "just the org
 * list" reaches for the one function that already returns it, and the import
 * resolves, typechecks, lints and ships. This is the exact line the gate exists
 * to stop, and it must be caught by its package subpath.
 */
const PLANTED_PRODUCTION_IMPORT = fixture(
  "apps/web/app/api/first-run/slack/status/route.ts",
  `import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";

export async function GET() {
  return Response.json(await listOrgsWithActiveSlackConnection(db));
}
`,
);

/**
 * The same offence routed around the package boundary — a deep relative path
 * into `packages/db/src/system/`, which is what someone writes when the subpath
 * import is the thing they were told not to do. Separate fixture because it is
 * the SECOND pattern in `SYSTEM_IMPORT_PATTERNS`, and a control that only
 * exercises the first leaves the other free to rot.
 */
const PLANTED_PRODUCTION_RELATIVE_IMPORT = fixture(
  "apps/web/lib/first-run/status.ts",
  `import { systemContextFor } from "../../../../packages/db/src/system/system-actor";
`,
);

/**
 * The clean fixture for the exclusion: the real shape of the file that forced
 * this narrowing — a suite under `__tests__/` importing the system module to
 * build a fixture. It must NOT be caught, and the assertion proving that is
 * what turns the exclusion from an assumption into a tested claim.
 */
const CLEAN_TEST_DIR_IMPORT = fixture(
  "apps/web/__tests__/first-run/nullable-channel-readers.test.ts",
  `import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";
`,
);

/** The same, colocated rather than under `__tests__/` — the suffix leg. */
const CLEAN_COLOCATED_TEST_IMPORT = fixture(
  "apps/web/lib/first-run/status.spec.ts",
  `import { systemContextFor } from "../../../../packages/db/src/system/system-actor";
`,
);

/**
 * A production file that imports the SCOPED barrel. Not caught — otherwise the
 * detector is matching "db" rather than "the system subpath", and every row
 * below would be reporting a boundary breach that is just an ordinary import.
 */
const CLEAN_PRODUCTION_IMPORT = fixture(
  "apps/web/lib/first-run/status.ts",
  `import { createSlackConnectionsRepo } from "@growthmind/db";
`,
);

describe("system subpath unreachability", () => {
  // -- item 83
  //
  // WHAT THIS GUARDS. `packages/db/src/system/` is the one module that can mint
  // a `TenantContext` for an arbitrary organization with NO USER PRESENT
  // (`systemContextFor`), claim connection rows across every tenant at once
  // (`claimDuePollableConnections`), and open credential material
  // (`readConnectionCredential`). It exists because the worker's cron tasks have
  // no request and therefore no session to derive a scope from. Everything the
  // request path does to keep one org's data away from another's is, inside this
  // module, simply not applied.
  //
  // WHY A PRODUCTION IMPORT UNDER apps/ IS DANGEROUS. Web-app code ships, and
  // ships attached to a request. A route handler holding `systemContextFor` can
  // name any organization it can parse out of a body, a query param or a header
  // and build a fully-privileged repository for it — the D7 "path that steps
  // outside the context flow", except the bypass is imported rather than
  // written. It typechecks, it lints, and nothing at runtime objects.
  //
  // WHY A TEST IMPORT IS NOT. A file under `__tests__/`, or named `*.test.ts` /
  // `*.spec.ts`, is not bundled into the app, is not reachable from any route,
  // and receives no request. There is no actor to escalate and no tenant to
  // cross. A suite reaching for the system module is EXERCISING the boundary —
  // building a cross-org fixture the scoped repositories deliberately cannot
  // build — which is the opposite of crossing it in production.
  //
  // THE SCAN IS THEREFORE PRODUCTION-ONLY, ON PURPOSE. The invariant is about
  // reachability of shipped code, not about the string appearing under `apps/`.
  // That narrowing was forced by `apps/web/__tests__/first-run/
  // nullable-channel-readers.test.ts`, whose import is correct and necessary
  // (AD-4's delivery-population fixture needs the org-agnostic listing).
  //
  // THIS IS THE FLOOR, NOT A PRECEDENT. The exclusion is exactly two things: a
  // `__tests__` path segment, and a test-file suffix. Nothing else is
  // exempt — not `scripts/`, not `dev-only` files, not anything behind a flag,
  // because "does not ship" is a claim only the two exclusions above can
  // actually make good on. Widening this list is widening the tenant boundary,
  // and the next person to want an exemption should move their fixture into
  // `packages/db/__tests__/` instead.
  //
  // AND IT SHIPS BOTH CONTROLS, asserted BEFORE any claim about the real tree.
  // Without them this scan could match nothing at all — a broken regex, a path
  // separator that stopped normalising, a filter that excluded everything — and
  // report green forever, which on THIS row means reporting that the tenant
  // boundary is intact because the scanner could not read it.
  it("has no production file under apps/ importing the db system module", () => {
    // POSITIVE CONTROL. The detector fires on a shipped file, by subpath...
    expect(systemImportOffenders([PLANTED_PRODUCTION_IMPORT])).toEqual([
      "apps/web/app/api/first-run/slack/status/route.ts",
    ]);
    // ...and on the same offence routed through a deep relative path.
    expect(systemImportOffenders([PLANTED_PRODUCTION_RELATIVE_IMPORT])).toEqual([
      "apps/web/lib/first-run/status.ts",
    ]);

    // CLEAN CONTROLS. The exclusion is proved, not assumed: the identical import
    // under a test path is not an offence — by directory, and by suffix.
    expect(systemImportOffenders([CLEAN_TEST_DIR_IMPORT])).toEqual([]);
    expect(systemImportOffenders([CLEAN_COLOCATED_TEST_IMPORT])).toEqual([]);
    // ...and the detector is about the SUBPATH, not about importing the db.
    expect(systemImportOffenders([CLEAN_PRODUCTION_IMPORT])).toEqual([]);

    const scanned: ScannedSource[] = listSourceFiles(path.join(REPO_ROOT, "apps")).map((file) => ({
      path: relative(file),
      source: readFileSync(file, "utf8"),
    }));

    // The scan must actually see the web app, or the assertion is vacuous.
    expect(scanned.length).toBeGreaterThan(0);

    const production = scanned.filter((file) => !isTestPath(file.path));

    // ...and it must still see it AFTER the exclusion. An exclusion that ate the
    // whole tree would pass the row above and assert over nothing.
    expect(production.length).toBeGreaterThan(0);

    // The exclusion must also ENGAGE on the real tree, not only on fixtures.
    // This is the leg the planted controls cannot cover: if `relative()` ever
    // stopped normalising Windows separators, `isTestPath` would match every
    // fixture above and no real file, and the exclusion would be silently inert.
    expect(production.length).toBeLessThan(scanned.length);

    expect(systemImportOffenders(scanned)).toEqual([]);
  });

  // -- item 84
  //
  // The scheduled-actor vocabulary is guarded as a set, not as one symbol.
  // `systemContextFor` is the sharp one: it mints a tenant context for an arbitrary
  // organization with no user present, which is exactly the capability the request path
  // exists to withhold. `SYSTEM_ACTOR` is guarded beside it because naming an actor is
  // the only input that call needs.
  //
  // Guarding the set rather than a single name is deliberate. This assertion previously
  // named `SYSTEM_ACTOR_ID` alone; when that constant was folded into the
  // `SYSTEM_ACTOR` union the test would have kept passing while checking for a symbol
  // that no longer existed anywhere. A green gate over an unguarded boundary. Anything
  // added to `system-actor.ts` that can mint or name a system scope belongs in this
  // list on the same commit.
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

  // Not vacuous: the guard above only means anything if the vocabulary it scans for is
  // actually present somewhere it IS allowed. If a rename ever empties
  // `system-actor.ts` of these names, this fails rather than letting the containment
  // assertion pass over nothing.
  it("finds the guarded vocabulary in the module it is meant to contain", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "packages", "db", "src", "system", "system-actor.ts"),
      "utf8",
    );

    for (const pattern of ACTOR_VOCABULARY) {
      expect(source).toMatch(pattern);
    }
  });

  // -- item 85
  it("exports none of the four system functions from the main db barrel", () => {
    const exported = Object.keys(dbBarrel);

    expect(exported).not.toContain("claimDuePollableConnections");
    expect(exported).not.toContain("readConnectionCredential");
    expect(exported).not.toContain("systemTenantContextFor");
    expect(exported).not.toContain("listAnalysableProjects");
    expect(exported).not.toContain("SYSTEM_ACTOR");
    expect(exported).not.toContain("systemContextFor");

    // Not vacuous: the barrel really is loaded and really does export the scoped
    // repositories.
    expect(exported).toContain("createProjectConnectionsRepo");
    expect(exported).toContain("createSessionsRepo");
  });

  // -- item 85 (source-level)
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

  // -- item 86 (type level)
  it("declares no credential-bearing field on PollableConnection", () => {
    // The compile-time half. `AssertNever` only accepts `never`, so the day a
    // `credentialCiphertext` (or any sibling below) is added to `PollableConnection`,
    // `Extract` stops being empty and `bun run typecheck` fails before a single test
    // runs.
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

  // -- item 86 (runtime shape on a real claimed row)
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

    // Runtime half, and deliberately broader than the type: a hand-written claim query
    // returning `SELECT *` would smuggle the ciphertext through under a name the
    // interface never declared.
    const keys = Object.keys(mine as object);
    expect(keys.filter((key) => /credential|secret|token|api_?key|password/i.test(key))).toEqual(
      [],
    );
    // The seeded envelope value must not ride along under any other name.
    expect(JSON.stringify(mine)).not.toContain("v1.00000000");

    // The sentinel context is derived from the claimed row, not a payload.
    const ctx = systemTenantContextFor(mine as PollableConnection);
    expect(ctx.userId).toBe(SYSTEM_ACTOR.SESSION_SOURCE_POLL);
    expect(ctx.organizationId).toBe(org.organizationId);
  });

  // -- item 87
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

    // The same connection id, named by another organization, yields nothing. A
    // connection id alone is never enough to reach key material.
    expect(
      await readConnectionCredential(db, {
        connectionId: connection.id,
        organizationId: orgB.organizationId,
      }),
    ).toBeNull();
  });

  // -- item 87 (signature)
  it("accepts the organization id as a required parameter on readConnectionCredential", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "packages", "db", "src", "system", "pollable-connections.ts"),
      "utf8",
    );
    const signature = /readConnectionCredential\s*\(([\s\S]*?)\)\s*:/.exec(source);
    expect(signature).not.toBeNull();
    expect(signature?.[1]).toMatch(/organizationId\s*:\s*string/);
    // Not optional: an optional org id is an id-only path with extra steps.
    expect(signature?.[1]).not.toMatch(/organizationId\s*\?/);
  });
});
