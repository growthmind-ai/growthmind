// UX First-Run Checklist row 9 ("Back to all companies" link on the detail page). Code review
// (CR-1) found the ADD claimed this was "folded into" a page-shape test that was never written —
// the detail page is an async server component (`params: Promise<...>`), so a standalone
// react-dom/server render has no precedent in this suite; identity-key-guard.test.ts already
// establishes the source-grep alternative for this exact companies surface, and that pattern is
// used here.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_PATH = path.join(
  import.meta.dir,
  "..",
  "..",
  "app",
  "(app)",
  "companies",
  "[domain]",
  "page.tsx",
);

describe("the company detail page's back-link (UX First-Run Checklist row 9)", () => {
  test("links back to the companies list route, not the detail route it's currently on", () => {
    const source = readFileSync(PAGE_PATH, "utf8");

    // The link must point at the list route (ROUTES.companies), never at the detail template
    // (ROUTES.companyDetail) — a mixup here would send the user back to the page they're already on.
    expect(source).toMatch(/<AnchorLink\s+href=\{ROUTES\.companies\}>/);
    expect(source).not.toMatch(/<AnchorLink\s+href=\{ROUTES\.companyDetail\}>/);

    // The link's visible label — a "now what?" affordance, not a bare icon.
    expect(source).toMatch(/<AnchorLink\s+href=\{ROUTES\.companies\}>[^<]*Back to all companies/);
  });
});
