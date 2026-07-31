// Wave 0b — lane L3, fixture seed prefix `db-`.
// ADD tasks/session-source-posthog-adapter/add.md §9 items 83–87 — FR-23 / D-10 / D7.
//
// D-10 asks for a stated mechanism PLUS a proof of unreachability. The
// mechanism is the `"./system"` subpath: `src/system/` is absent from the main
// barrel, so a web-app import of it is a single greppable line. This file is
// what turns that convention into a gate.
//
// Items 83–85 are structural invariants over source, so they hold against the
// Wave 0a scaffold already and are guardrails rather than red tests — their
// job starts the moment someone wires the worker up and reaches for a
// shortcut. Items 86–87 are behavioural and fail on the typed stubs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import * as dbBarrel from "../../src/index";
import {
  claimDuePollableConnections,
  readConnectionCredential,
  systemTenantContextFor,
  SYSTEM_ACTOR_ID,
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

describe("system subpath unreachability (FR-23)", () => {
  // --- item 83 -------------------------------------------------------------
  it("has no file under apps/ importing the db system module", () => {
    const files = listSourceFiles(path.join(REPO_ROOT, "apps"));
    // The scan must actually see the web app, or the assertion is vacuous.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /["']@growthmind\/db\/system["']/.test(source) ||
        /["'][^"']*packages\/db\/src\/system[^"']*["']/.test(source)
      );
    });

    expect(offenders.map(relative)).toEqual([]);
  });

  // --- item 84 -------------------------------------------------------------
  it("names SYSTEM_ACTOR_ID only under the db system module, the worker, and tests", () => {
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

    const offenders = files.filter(
      (file) => !allowed(file) && /\bSYSTEM_ACTOR_ID\b/.test(readFileSync(file, "utf8")),
    );

    expect(offenders.map(relative)).toEqual([]);
  });

  // --- item 85 -------------------------------------------------------------
  it("exports none of the four system functions from the main db barrel", () => {
    const exported = Object.keys(dbBarrel);

    expect(exported).not.toContain("claimDuePollableConnections");
    expect(exported).not.toContain("readConnectionCredential");
    expect(exported).not.toContain("systemTenantContextFor");
    expect(exported).not.toContain("listAnalysableProjects");
    expect(exported).not.toContain("SYSTEM_ACTOR_ID");

    // Not vacuous: the barrel really is loaded and really does export the
    // scoped repositories.
    expect(exported).toContain("createProjectConnectionsRepo");
    expect(exported).toContain("createSessionsRepo");
  });

  // --- item 85 (source-level) ---------------------------------------------
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

  // --- item 86 (type level) ------------------------------------------------
  it("declares no credential-bearing field on PollableConnection", () => {
    // The compile-time half. `AssertNever` only accepts `never`, so the day a
    // `credentialCiphertext` (or any sibling below) is added to
    // `PollableConnection`, `Extract` stops being empty and `bun run
    // typecheck` fails before a single test runs.
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

  // --- item 86 (runtime shape on a real claimed row) -----------------------
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

    // Runtime half, and deliberately broader than the type: a hand-written
    // claim query returning `SELECT *` would smuggle the ciphertext through
    // under a name the interface never declared.
    const keys = Object.keys(mine as object);
    expect(keys.filter((key) => /credential|secret|token|api_?key|password/i.test(key))).toEqual(
      [],
    );
    // The seeded envelope value must not ride along under any other name.
    expect(JSON.stringify(mine)).not.toContain("v1.00000000");

    // The sentinel context is derived from the claimed row, not a payload.
    const ctx = systemTenantContextFor(mine as PollableConnection);
    expect(ctx.userId).toBe(SYSTEM_ACTOR_ID);
    expect(ctx.organizationId).toBe(org.organizationId);
  });

  // --- item 87 -------------------------------------------------------------
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

    // The same connection id, named by another organization, yields nothing.
    // A connection id alone is never enough to reach key material.
    expect(
      await readConnectionCredential(db, {
        connectionId: connection.id,
        organizationId: orgB.organizationId,
      }),
    ).toBeNull();
  });

  // --- item 87 (signature) -------------------------------------------------
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
