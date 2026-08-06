import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { liveTopicSchema } from "@growthmind/shared";

// apps/web has no DOM renderer and the page is an async server component doing database I/O,
// so the mount is read off the source rather than rendered. Weaker than a render, and chosen
// over prop-injecting the page's dependencies to make one possible.
const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DETAIL_PAGE = path.join(WEB_ROOT, "app", "(app)", "replays", "[recordingId]", "page.tsx");
const REPLAY_COMPONENTS = path.join(WEB_ROOT, "components", "replay");

const NO_POLLING = /setInterval\(|setTimeout\([^)]*refresh/i;

function detailPageSource(): string {
  return readFileSync(DETAIL_PAGE, "utf8");
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("the replay detail page hears a recording change", () => {
  test("the detail page mounts LiveRefresh on the recordings topic", () => {
    // Parsed rather than written down, so a rename in packages/shared fails this test instead
    // of leaving it green against a topic nothing publishes (D11).
    const topic = liveTopicSchema.parse("recordings");

    expect(detailPageSource()).toMatch(new RegExp(`<LiveRefresh\\s+topics=\\{\\["${topic}"\\]\\}`));
  });

  // A user landing after the write sees the settled state only while the page renders from the
  // database on load; the live mount is the second half of that, never a replacement for it.
  test("the detail page keeps force-dynamic", () => {
    expect(detailPageSource()).toContain('export const dynamic = "force-dynamic"');
  });

  test("nothing in the replay tree gains a timer", () => {
    const offenders = [DETAIL_PAGE, ...sourceFiles(REPLAY_COMPONENTS)]
      .filter((file) => NO_POLLING.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(WEB_ROOT, file).replaceAll("\\", "/"))
      .toSorted();

    expect(offenders).toEqual([]);
  });
});
