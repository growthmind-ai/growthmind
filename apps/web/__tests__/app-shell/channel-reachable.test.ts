// The delivery record is the only surface that can show a post which never arrived — a
// failed post is invisible in Slack by construction. A customer off the preview allow list
// getting a 404 here means the one thing this page exists for is unreachable for almost
// everyone, exactly as /findings was before O-041.
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

describe("the delivery record is reachable by every org member (D1, D7)", () => {
  test("the live page exists on disk at the plain, non-preview route", () => {
    expect(pageFilesUnder(APP_DIR)).toContain("(app)/channel/page.tsx");
  });

  test("no copy of it is left inside the preview group, whose layout 404s the unlisted", () => {
    const behindTheGate = pageFilesUnder(APP_DIR).filter(
      (file) => file.includes("(preview)/") && file.endsWith("channel/page.tsx"),
    );

    expect(behindTheGate).toEqual([]);
  });

  test("a viewer who is not on the preview allow list still has a way to the record", () => {
    const hrefs = hrefsIn(navGroupsFor(false));

    if (!hrefs.includes(ROUTES.channel)) {
      throw new Error(
        `the nav offers no route to ${ROUTES.channel} for a viewer off the preview allow list. ` +
          `The page now reads real deliveries under the org's own tenant context, so it answers ` +
          `for everyone — move it out of the preview-only Work group into WORK_LIVE in ` +
          `lib/app-nav.ts. Offered: ${hrefs.join(", ")}`,
      );
    }

    expect(hrefs).toContain(ROUTES.channel);
  });

  test("a preview viewer sees it too, in the group it belongs to", () => {
    expect(hrefsIn(navGroupsFor(true))).toContain(ROUTES.channel);
  });
});
