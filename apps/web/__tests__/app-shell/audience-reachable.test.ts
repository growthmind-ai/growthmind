// O-036: /audience comes off its hand-authored fixture onto the live twelve-kind model.
// Like /data, /fixes and /channel before it (record-reachable.test.ts, the template), every
// org member must reach it regardless of GROWTHMIND_PREVIEW_USER_IDS membership, and the
// fixture reader must be gone rather than left as a second producer of the page.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { navGroupsFor, type NavGroup } from "../../lib/app-nav";
import { ROUTES } from "../../lib/routes";

const WEB_ROOT = path.join(import.meta.dir, "..", "..");
const APP_DIR = path.join(WEB_ROOT, "app");

const PRODUCT_GROUP_LABEL = "Your product";

function hrefsIn(groups: readonly NavGroup[]): readonly string[] {
  return groups.flatMap((group) => group.items.map((item) => item.href));
}

function pageFilesUnder(dir: string): readonly string[] {
  const found: string[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry === "page.tsx") found.push(path.relative(APP_DIR, full).split(path.sep).join("/"));
    }
  };

  walk(dir);
  return found;
}

// Non-test source only: this file names the symbol it hunts, and a test naming a corpse is
// not the corpse.
function sourceFilesNaming(pattern: RegExp): readonly string[] {
  const offenders: string[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "__tests__" && entry !== "node_modules") walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      if (pattern.test(readFileSync(full, "utf8"))) {
        offenders.push(path.relative(WEB_ROOT, full).split(path.sep).join("/"));
      }
    }
  };

  for (const dir of ["app", "components", "lib"]) {
    const full = path.join(WEB_ROOT, dir);
    if (existsSync(full)) walk(full);
  }

  return offenders;
}

describe("the audience page is reachable live by every org member (FR-1, FR-2, D1, D7)", () => {
  test("a viewer off the preview allow list has a way to /audience, under Your product", () => {
    const groups = navGroupsFor(false);
    const product = groups.find((group) => group.label === PRODUCT_GROUP_LABEL);
    const hrefs = (product?.items ?? []).map((item) => item.href);

    if (!hrefs.includes(ROUTES.audience)) {
      throw new Error(
        `the "${PRODUCT_GROUP_LABEL}" group offers no route to ${ROUTES.audience} for a viewer ` +
          `off the preview allow list. The majority of real customers are never on that list, ` +
          `and a model of their audience they cannot reach is not a model. Offered: ` +
          `${hrefs.join(", ") || "(nothing)"}`,
      );
    }

    expect(hrefs).toContain(ROUTES.audience);
  });

  // Green today and must stay green: moving the item out of the preview PRODUCT group must
  // not cost a preview viewer their way to it.
  test("a preview viewer keeps a way to /audience too", () => {
    expect(hrefsIn(navGroupsFor(true))).toContain(ROUTES.audience);
  });

  test("the live page exists on disk at the plain (non-preview) route", () => {
    expect(pageFilesUnder(APP_DIR)).toContain("(app)/audience/page.tsx");
  });

  test("no audience page sits inside the preview group, whose layout 404s the unlisted", () => {
    const behindTheGate = pageFilesUnder(APP_DIR).filter(
      (file) => file.includes("(preview)/") && file.endsWith("audience/page.tsx"),
    );

    if (behindTheGate.length > 0) {
      throw new Error(
        `${behindTheGate.join(", ")} is inside the (preview) group, whose layout calls ` +
          `notFound() for anyone off GROWTHMIND_PREVIEW_USER_IDS. A customer would get a 404 ` +
          `on the audience model AGENTS.md's delivery commitment requires the web app to carry.`,
      );
    }

    expect(behindTheGate).toEqual([]);
  });

  test("the fixture reader readAudience is gone from apps/web", () => {
    const offenders = sourceFilesNaming(/\breadAudience\b/);

    if (offenders.length > 0) {
      throw new Error(
        `readAudience is still defined or imported by: ${offenders.join(", ")}. FR-1 deletes ` +
          `the fixture reader with the page move — left behind, it is a second producer of an ` +
          `audience view that no longer matches the persisted model.`,
      );
    }

    expect(offenders).toEqual([]);
  });
});
