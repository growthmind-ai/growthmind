// O-041's wiring gap fix retires the preview fixtures for /findings — real findings now
// persist under a live route. Like /replays, /agent and /companies before it, every org
// member must reach it regardless of GROWTHMIND_PREVIEW_USER_IDS membership.
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { navGroupsFor, type NavGroup } from "../../lib/app-nav";
import { ROUTES } from "../../lib/routes";

const APP_DIR = path.join(import.meta.dir, "..", "..", "app");

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

describe("the findings page is reachable by every org member (D1, D7)", () => {
  test("a viewer who is not on the preview allow list still has a way to /findings", () => {
    const hrefs = hrefsIn(navGroupsFor(false));

    if (!hrefs.includes(ROUTES.findings)) {
      throw new Error(
        `the nav offers no route to ${ROUTES.findings} for a viewer off the preview allow list. ` +
          `/replays, /agent and /companies all live outside the (preview) group for the same ` +
          `reason: the majority of real customers are never on that allow-list. ` +
          `Offered: ${hrefs.join(", ")}`,
      );
    }

    expect(hrefs).toContain(ROUTES.findings);
  });

  test("a preview viewer sees it too, in the group it belongs to", () => {
    expect(hrefsIn(navGroupsFor(true))).toContain(ROUTES.findings);
  });

  test("neither the list nor the detail page sits inside the preview group, whose layout 404s the unlisted", () => {
    const pages = pageFilesUnder(APP_DIR);

    const behindTheGate = pages.filter(
      (file) =>
        file.includes("(preview)/") &&
        (file.endsWith("findings/page.tsx") || file.endsWith("findings/[id]/page.tsx")),
    );

    if (behindTheGate.length > 0) {
      throw new Error(
        `${behindTheGate.join(", ")} is inside the (preview) group, whose layout calls ` +
          `notFound() for anyone off GROWTHMIND_PREVIEW_USER_IDS. A customer would get a 404 ` +
          `on the findings record AGENTS.md's delivery commitment requires the web app carry.`,
      );
    }

    expect(behindTheGate).toEqual([]);
  });

  test("the live list and detail pages exist on disk at the plain (non-preview) route", () => {
    const pages = pageFilesUnder(APP_DIR);

    expect(pages).toContain("(app)/findings/page.tsx");
    expect(pages).toContain("(app)/findings/[id]/page.tsx");
  });
});
