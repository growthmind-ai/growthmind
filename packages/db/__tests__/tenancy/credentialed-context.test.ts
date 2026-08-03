import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const SRC_DIR = path.join(REPO_ROOT, "packages", "db", "src");

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

interface ScannedSource {
  readonly path: string;
  readonly source: string;
}

const fixture = (filePath: string, source: string): ScannedSource => ({ path: filePath, source });

const TEST_DIRS = new Set(["__tests__"]);

const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function isTestPath(rel: string): boolean {
  const segments = rel.split("/");
  const name = segments.pop() ?? "";
  return (
    segments.some((segment) => TEST_DIRS.has(segment)) ||
    TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

const CONTEXT_CONSTRUCTION = /tenantContextSchema\s*\.\s*(?:safeParse|parse)\b/;

// Every PRODUCTION file in `files` that mints a tenant context of its own, by path.
const contextConstructors = (files: readonly ScannedSource[]): readonly string[] =>
  files
    .filter((file) => !isTestPath(file.path) && CONTEXT_CONSTRUCTION.test(file.source))
    .map((file) => file.path);

// The realistic offending edit: the interactivity route inventing a tenancy out of the
// Slack payload's team id. It resolves, typechecks, lints and ships.
const PLANTED_ROUTE_CONSTRUCTION = fixture(
  "apps/web/app/api/slack/interactivity/route.ts",
  `import { tenantContextSchema } from "@growthmind/shared";

export async function POST(request: Request) {
  const payload = await request.json();
  const ctx = tenantContextSchema.parse({
    userId: "slack",
    organizationId: payload.team.id,
    organizationName: "",
    role: "member",
  });
  return Response.json({ ok: Boolean(ctx) });
}
`,
);

// The lawful session path: the org is derived from an authenticated membership, never named.
const CLEAN_SESSION_DERIVATION = fixture(
  "apps/web/lib/tenant.ts",
  `import { deriveTenantContext } from "@growthmind/shared";

export async function getTenantContext() {
  return deriveTenantContext({ session, memberships });
}
`,
);

// A fixture builds contexts on purpose; it is reachable from no route and receives no request.
const CLEAN_TEST_FIXTURE = fixture(
  "apps/web/__tests__/tenancy/helpers/auth-fixture.ts",
  `import { tenantContextSchema } from "@growthmind/shared";

export const contextFor = (organizationId: string) =>
  tenantContextSchema.parse({ userId: "u", organizationId, organizationName: "n", role: "owner" });
`,
);

function parameterListOf(source: string, functionName: string): string {
  const head = new RegExp(`function\\s+${functionName}\\s*\\(`).exec(source);
  expect(head).not.toBeNull();

  const openIndex = (head?.index ?? 0) + (head?.[0].length ?? 1) - 1;
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }

  throw new Error(`${functionName}: its parameter list never closes`);
}

describe("a credentialed context is minted in packages/db, never in apps/", () => {
  it("constructs no tenant context in any production file under apps/", () => {
    expect(contextConstructors([PLANTED_ROUTE_CONSTRUCTION])).toEqual([
      "apps/web/app/api/slack/interactivity/route.ts",
    ]);

    expect(contextConstructors([CLEAN_SESSION_DERIVATION])).toEqual([]);
    expect(contextConstructors([CLEAN_TEST_FIXTURE])).toEqual([]);

    const scanned: ScannedSource[] = listSourceFiles(path.join(REPO_ROOT, "apps")).map((file) => ({
      path: relative(file),
      source: readFileSync(file, "utf8"),
    }));

    expect(scanned.length).toBeGreaterThan(0);

    const production = scanned.filter((file) => !isTestPath(file.path));

    expect(production.length).toBeGreaterThan(0);
    expect(production.length).toBeLessThan(scanned.length);

    expect(contextConstructors(scanned)).toEqual([]);
  });

  it("resolves an api-key principal from the presented secret and nothing else", () => {
    const source = readFileSync(path.join(SRC_DIR, "repositories", "api-keys.repo.ts"), "utf8");
    const params = parameterListOf(source, "resolveApiKeyPrincipal");

    expect(params).toMatch(/presented\s*:\s*string/);
    expect(params).not.toMatch(/\borganizationId\b/);
    expect(params).not.toMatch(/\borgId\b/);
    expect(params).not.toMatch(/\borganization_id\b/);
  });

  it("resolves an interaction principal from a delivery row and nothing else", () => {
    const source = readFileSync(path.join(SRC_DIR, "repositories", "deliveries.repo.ts"), "utf8");
    const params = parameterListOf(source, "resolveDeliveryForInteraction");

    const named = [...params.matchAll(/(\w+)\s*:\s*string/g)].map((match) => match[1]);
    expect(named.toSorted()).toEqual(["channelId", "messageRef"]);

    expect(params).not.toMatch(/\borganizationId\b/);
    expect(params).not.toMatch(/\bteamId\b/);
    expect(params).not.toMatch(/\buserId\b/);
  });
});
