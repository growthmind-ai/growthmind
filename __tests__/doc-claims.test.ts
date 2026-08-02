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
  "docs/mvp.md",
  "docs/get-started.md",
  "docs/telemetry.md",
  "docs/reliability-checklist.md",
];

/** Gitignored here, so a link into one resolves for a maintainer and 404s for everyone else. */
const NOT_PUBLISHED = /^(tasks|docs\/prds|docs\/adds|\.ai|\.claude|local)\//;

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

/**
 * Claims the repository can check about itself. Each is a sentence a reader would
 * act on, paired with the condition that makes it true.
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
    claim: /experiments from \$20\/mo/i,
    holdsWhen: () => false,
    because: "$20/mo buys hosting, not experiments; one active experiment is free",
  },
  {
    file: "README.md",
    claim: /No skills directory exists here today/i,
    holdsWhen: () => !existsSync(`${ROOT}/skills`),
    because: "a skills/ directory now exists",
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
      (entry) => entry.claim.test(read(entry.file)) && !entry.holdsWhen(),
    ).map((entry) => `${entry.file}: "${entry.claim.source}" — ${entry.because}`);

    expect(contradicted).toEqual([]);
  });

  test("the ledger bites — a claim present with its condition false is reported", () => {
    const planted = { claim: /Growthmind/, holdsWhen: (): boolean => false };
    expect(planted.claim.test(read("README.md")) && !planted.holdsWhen()).toBe(true);
  });
});
