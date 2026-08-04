// O-026 shipped browser key minting into `/first-run` and nowhere else, and
// `first-run-constraints.test.ts` enforces that nothing links back to that surface. The
// two together meant a founder who dismissed setup, and every teammate who joined after
// it, could never mint a key again. These are the guards on the way back.
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

describe("the agent page is reachable by someone who has left setup (D1, D4)", () => {
  test("CONTROL: the href scan reports a group that does not carry the agent page", () => {
    const withoutAgent: readonly NavGroup[] = [
      { label: null, items: [{ href: ROUTES.home, label: "Home" }] },
    ];

    expect(hrefsIn(withoutAgent)).not.toContain(ROUTES.agent);
    expect(hrefsIn([{ label: "x", items: [{ href: ROUTES.agent, label: "y" }] }])).toContain(
      ROUTES.agent,
    );
  });

  test("a viewer who is not on the preview allow list still has a way to the key", () => {
    const hrefs = hrefsIn(navGroupsFor(false));

    if (!hrefs.includes(ROUTES.agent)) {
      throw new Error(
        `the nav offers no route to ${ROUTES.agent} for a viewer off the preview allow list. ` +
          `Setup is deliberately not linkable back to, so this entry is the ONLY way to mint ` +
          `or revoke a key once it is dismissed — removing it strands every existing org. ` +
          `Offered: ${hrefs.join(", ")}`,
      );
    }

    expect(hrefs).toContain(ROUTES.agent);
    expect(hrefs).toContain(ROUTES.home);
  });

  test("a preview viewer sees it too, in the group it belongs to", () => {
    expect(hrefsIn(navGroupsFor(true))).toContain(ROUTES.agent);
  });

  test("the page does not sit inside the preview group, whose layout 404s the unlisted", () => {
    const pages = pageFilesUnder(APP_DIR);

    expect(pages).toContain("(app)/agent/page.tsx");

    const behindTheGate = pages.filter(
      (file) => file.includes("(preview)/") && file.endsWith("agent/page.tsx"),
    );

    if (behindTheGate.length > 0) {
      throw new Error(
        `${behindTheGate.join(", ")} is inside the (preview) group, whose layout calls ` +
          `notFound() for anyone off GROWTHMIND_PREVIEW_USER_IDS. A customer would get a 404 ` +
          `on the one page that mints their key.`,
      );
    }

    expect(behindTheGate).toEqual([]);
  });
});
