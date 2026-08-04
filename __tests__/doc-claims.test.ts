import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SCANNED = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "REVIEW.md",
  "SECURITY.md",
  "docs/architecture.md",
  "docs/product-decisions.md",
  "docs/stack.md",
  "docs/get-started.md",
  "docs/telemetry.md",
  "docs/reliability-checklist.md",
];

/** Gitignored here, so a link into one resolves for a maintainer and 404s for everyone else. */
const NOT_PUBLISHED = /^(tasks|\.ai|\.claude|local)\//;

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;

function read(file: string): string {
  return readFileSync(`${ROOT}/${file}`, "utf8");
}

function brokenLinksIn(file: string): string[] {
  const broken: string[] = [];

  for (const [, target] of read(file).matchAll(MARKDOWN_LINK)) {
    const raw = (target ?? "").trim();
    if (raw === "" || /^(https?:|mailto:|#)/.test(raw)) continue;

    const path = (raw.split("#")[0] ?? "").trim();
    if (path === "" || NOT_PUBLISHED.test(path)) continue;

    const from = file.includes("/") ? `${file.slice(0, file.lastIndexOf("/"))}/` : "";
    if (!existsSync(`${ROOT}/${from}${path}`) && !existsSync(`${ROOT}/${path}`)) {
      broken.push(`${file} → ${raw}`);
    }
  }

  return broken;
}

// Regression guards, both dormant: these two sentences left docs/get-started.md
// when setup started minting keys and the tools started reading real rows. They
// stay armed so neither can come back while the code contradicts it, and `\s+`
// rather than a literal space is what let the first one match the mid-phrase wrap
// the document gave it.
const GET_STARTED_NO_KEY_SCREEN = /no key-management\s+screen/i;

const GET_STARTED_NO_FINDINGS_TABLE = /no table\s+of\s+findings/i;

/**
 * Claims the repository can check about itself. Each is a sentence a reader would
 * act on, paired with the condition that makes it true. Entries under `.ai/` are
 * checked only where that directory exists — it is gitignored, so CI never sees them.
 */
const CLAIMS: readonly {
  readonly file: string;
  readonly claim: RegExp;
  readonly holdsWhen: () => boolean;
  readonly because: string;
}[] = [
  {
    file: "README.md",
    claim: /No MCP server[^.]*exists in this repository today/i,
    holdsWhen: () => !existsSync(`${ROOT}/apps/web/app/api/mcp/route.ts`),
    because: "apps/web/app/api/mcp/route.ts exists — the MCP server shipped",
  },
  {
    file: "README.md",
    claim: /What runs today is a scaffold/i,
    holdsWhen: () => !existsSync(`${ROOT}/packages/core/src/detect/funnel-dropoff.ts`),
    because: "detectors, the evidence gate and the findings table shipped",
  },
  {
    file: "README.md",
    claim: /\$120|\$950|Activation & Retention|The Full Shift|one active experiment/i,
    holdsWhen: () => false,
    because: "retired pricing: finding is free, $20/mo includes $20 of usage, custom above that",
  },
  {
    file: "README.md",
    claim: /No skills directory exists here today/i,
    holdsWhen: () => !existsSync(`${ROOT}/skills`),
    because: "a skills/ directory now exists",
  },
  {
    file: "docs/get-started.md",
    claim: GET_STARTED_NO_KEY_SCREEN,
    holdsWhen: () => !existsSync(`${ROOT}/apps/web/app/api/first-run/agent/key/route.ts`),
    because:
      "apps/web/app/api/first-run/agent/key/route.ts exists — /first-run mints a key in the browser",
  },
  {
    file: "docs/get-started.md",
    claim: GET_STARTED_NO_FINDINGS_TABLE,
    holdsWhen: () => !existsSync(`${ROOT}/packages/db/src/schema/fixes.ts`),
    because: "packages/db/src/schema/fixes.ts exists — the tools have read real rows since O-020",
  },
  {
    file: ".ai/decisions/0007-mcp-route-surface.md",
    claim: /No table records a finding or a fix/i,
    holdsWhen: () => !existsSync(`${ROOT}/packages/db/src/schema/fixes.ts`),
    because: "packages/db/src/schema/fixes.ts exists — a fix is recorded",
  },
  {
    file: ".ai/decisions/0007-mcp-route-surface.md",
    claim: /All three tools read real rows/i,
    holdsWhen: () => read("apps/web/app/api/mcp/route.ts").includes("createLiveReadPort"),
    because: "the mounted route no longer binds the live read port",
  },
  {
    file: ".ai/decisions/0007-mcp-route-surface.md",
    claim: /resolved by `resolveApiKeyPrincipal`/,
    holdsWhen: () =>
      read("packages/db/src/repositories/api-keys.repo.ts").includes(
        "export async function resolveApiKeyPrincipal",
      ),
    because: "packages/db no longer defines the credential resolver this record names",
  },
];

describe("documentation links", () => {
  test("every relative link in a published document resolves to a real path", () => {
    expect(SCANNED.flatMap(brokenLinksIn)).toEqual([]);
  });

  test("the scanner reaches real documents and real links", () => {
    expect(read("README.md")).toContain("Growthmind");
    expect([...read("README.md").matchAll(MARKDOWN_LINK)].length).toBeGreaterThan(10);
    expect(brokenLinksIn("README.md")).toEqual([]);
  });
});

describe("documentation claims", () => {
  test("no document makes a claim the repository contradicts", () => {
    const contradicted = CLAIMS.filter(
      (entry) =>
        existsSync(`${ROOT}/${entry.file}`) &&
        entry.claim.test(read(entry.file)) &&
        !entry.holdsWhen(),
    ).map((entry) => `${entry.file}: "${entry.claim.source}" — ${entry.because}`);

    expect(contradicted).toEqual([]);
  });

  test("the ledger bites — a claim present with its condition false is reported", () => {
    const planted = { claim: /Growthmind/, holdsWhen: (): boolean => false };
    expect(planted.claim.test(read("README.md")) && !planted.holdsWhen()).toBe(true);
  });

  test("the key-screen needle matches the wrap the document gave it, and neither sentence is in the document now", () => {
    // Both paragraphs verbatim from the commit that removed them (420b06c), wrap included.
    const keyScreen =
      "This surface reads with a key you mint yourself. There is no key-management\nscreen yet, it is one command, run from the repo root against a started stack:";
    const findingsTable =
      "There is no table of findings behind these tools yet. That is a separate piece\nof work, so every answer is honestly empty rather than absent.";

    expect(GET_STARTED_NO_KEY_SCREEN.test(keyScreen)).toBe(true);
    expect(/no key-management screen/i.test(keyScreen)).toBe(false);
    expect(GET_STARTED_NO_FINDINGS_TABLE.test(findingsTable)).toBe(true);

    const page = read("docs/get-started.md");
    expect(GET_STARTED_NO_KEY_SCREEN.test(page)).toBe(false);
    expect(GET_STARTED_NO_FINDINGS_TABLE.test(page)).toBe(false);

    expect(GET_STARTED_NO_KEY_SCREEN.test("the key screen lists every key")).toBe(false);
    expect(GET_STARTED_NO_FINDINGS_TABLE.test("a table of findings exists")).toBe(false);

    expect(CLAIMS.filter((entry) => entry.file === "docs/get-started.md")).toHaveLength(2);
  });
});
