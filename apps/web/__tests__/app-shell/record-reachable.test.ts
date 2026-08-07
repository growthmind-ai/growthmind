// O-035's last three fixture pages — /data, /fixes and /channel — come off static JSON onto
// live rows. Like /replays, /agent, /companies and /findings before them, every org member
// must reach them regardless of GROWTHMIND_PREVIEW_USER_IDS membership. One file rather than
// three because the three move together under one outcome; the sibling *-reachable tests
// stay per-page because each landed on its own.
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

const LIVE = [
  { route: ROUTES.data, name: "your data" },
  { route: ROUTES.fixes, name: "fixes" },
  { route: ROUTES.channel, name: "in Slack" },
] as const;

describe("the record pages are reachable by every org member (D1, D7)", () => {
  for (const { route, name } of LIVE) {
    test(`a viewer off the preview allow list still has a way to ${route}`, () => {
      const hrefs = hrefsIn(navGroupsFor(false));

      if (!hrefs.includes(route)) {
        throw new Error(
          `the nav offers no route to ${route} (${name}) for a viewer off the preview allow ` +
            `list. The majority of real customers are never on that list, and a record they ` +
            `cannot reach is not a record. Offered: ${hrefs.join(", ")}`,
        );
      }

      expect(hrefs).toContain(route);
    });

    test(`a preview viewer sees ${route} too, in the group it belongs to`, () => {
      expect(hrefsIn(navGroupsFor(true))).toContain(route);
    });
  }

  test("none of the three sits inside the preview group, whose layout 404s the unlisted", () => {
    const pages = pageFilesUnder(APP_DIR);

    const gated = ["data/page.tsx", "fixes/page.tsx", "fixes/[id]/page.tsx", "channel/page.tsx"];

    const behindTheGate = pages.filter(
      (file) => file.includes("(preview)/") && gated.some((tail) => file.endsWith(tail)),
    );

    if (behindTheGate.length > 0) {
      throw new Error(
        `${behindTheGate.join(", ")} is inside the (preview) group, whose layout calls ` +
          `notFound() for anyone off GROWTHMIND_PREVIEW_USER_IDS. A customer would get a 404 ` +
          `on the record AGENTS.md's delivery commitment requires the web app to carry.`,
      );
    }

    expect(behindTheGate).toEqual([]);
  });

  test("the live pages exist on disk at the plain (non-preview) routes", () => {
    const pages = pageFilesUnder(APP_DIR);

    expect(pages).toContain("(app)/data/page.tsx");
    expect(pages).toContain("(app)/fixes/page.tsx");
    expect(pages).toContain("(app)/fixes/[id]/page.tsx");
    expect(pages).toContain("(app)/channel/page.tsx");
  });

  // The two with no producer stay behind the gate, and stay labelled. Asserted here so that
  // moving the three does not quietly sweep these along with them: /experiments waits on
  // O-028 and O-034, /plan on O-033.
  test("experiments and plan stay inside the preview group until their producer ships", () => {
    const pages = pageFilesUnder(APP_DIR);

    expect(pages).toContain("(app)/(preview)/experiments/page.tsx");
    expect(pages).toContain("(app)/(preview)/plan/page.tsx");
  });
});
