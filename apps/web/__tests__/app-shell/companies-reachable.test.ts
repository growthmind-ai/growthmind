// O-039 adds /companies as a live account-view surface. Like /agent and /replays before it,
// every org member must reach it regardless of GROWTHMIND_PREVIEW_USER_IDS membership — the
// research for this sprint names agent-reachable.test.ts as the template for both checks.
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

describe("the companies page is reachable by every org member (D1, D7)", () => {
  test("CONTROL: the href scan reports a group that does not carry the companies page", () => {
    const withoutCompanies: readonly NavGroup[] = [
      { label: null, items: [{ href: ROUTES.home, label: "Home" }] },
    ];

    expect(hrefsIn(withoutCompanies)).not.toContain(ROUTES.companies);
    expect(hrefsIn([{ label: "x", items: [{ href: ROUTES.companies, label: "y" }] }])).toContain(
      ROUTES.companies,
    );
  });

  test("a viewer who is not on the preview allow list still has a way to /companies", () => {
    const hrefs = hrefsIn(navGroupsFor(false));

    if (!hrefs.includes(ROUTES.companies)) {
      throw new Error(
        `the nav offers no route to ${ROUTES.companies} for a viewer off the preview allow list. ` +
          `/replays and /agent both live outside the (preview) group for the same reason: the ` +
          `majority of real customers are never on that allow-list. Offered: ${hrefs.join(", ")}`,
      );
    }

    expect(hrefs).toContain(ROUTES.companies);
  });

  test("a preview viewer sees it too, in the group it belongs to", () => {
    expect(hrefsIn(navGroupsFor(true))).toContain(ROUTES.companies);
  });

  test("the page does not sit inside the preview group, whose layout 404s the unlisted", () => {
    const pages = pageFilesUnder(APP_DIR);

    const behindTheGate = pages.filter(
      (file) =>
        file.includes("(preview)/") &&
        (file.endsWith("companies/page.tsx") || file.endsWith("companies/[domain]/page.tsx")),
    );

    if (behindTheGate.length > 0) {
      throw new Error(
        `${behindTheGate.join(", ")} is inside the (preview) group, whose layout calls ` +
          `notFound() for anyone off GROWTHMIND_PREVIEW_USER_IDS. A customer would get a 404 ` +
          `on the account-view page this sprint exists to ship.`,
      );
    }

    expect(behindTheGate).toEqual([]);
  });
});
