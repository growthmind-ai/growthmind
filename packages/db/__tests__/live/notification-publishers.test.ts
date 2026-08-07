import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_TOPICS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

const DB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function src(...parts: string[]): string {
  return readFileSync(path.join(DB_ROOT, "src", ...parts), "utf8");
}

// Every table the bell is assembled from, paired with the one source that announces its
// writes. A row here with no publisher is a badge that stops moving, and there is no timer
// behind the bell to cover for it — the same gate first-run-publishers.test.ts holds for
// the setup screen. All four notification tables are written through the emit seam or the
// bell repo; only the emit announces, because bell-state writes are the viewer's own and
// the layout re-render they cause already carries them.
const BEHIND_THE_BELL = [
  { table: "notifications", source: ["notifications", "emit.ts"], topic: "notifications" },
] as const;

const SKIPPED_DIRS = new Set(["node_modules", "__tests__", ".next", "drizzle"]);

function walk(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

describe("the notifications topic is published from the repository write and nowhere else", () => {
  test("notifications is a declared topic", () => {
    expect(LIVE_TOPICS).toContain("notifications");
  });

  for (const { table, source, topic } of BEHIND_THE_BELL) {
    test(`${table} is published as ${topic} from ${source.join("/")}`, () => {
      expect(src(...source)).toContain(`topic: "${topic}"`);
    });

    // Presence of the import is what the first version of the first-run gate checked, and
    // deleting every call while keeping the helper kept it green — the bug that shipped.
    test(`${source.join("/")} calls its publisher rather than only importing one`, () => {
      const calls = src(...source).match(/await publishLive\(/g) ?? [];

      expect(calls.length).toBeGreaterThan(0);
    });
  }

  // Inverted on purpose: one home for the announce is the whole point of the emit seam. A
  // second publisher — a route, a task, a sibling repo — would fire refreshes the emit's
  // dedup conflict deliberately withholds, so any new source fails here by path.
  test("no other db, worker, or route source publishes the notifications topic", () => {
    const emitPath = path.join(DB_ROOT, "src", "notifications", "emit.ts");
    const roots = [
      path.join(DB_ROOT, "src"),
      path.join(DB_ROOT, "..", "..", "worker", "src"),
      path.join(DB_ROOT, "..", "..", "apps", "web", "app"),
    ];

    const offenders = roots
      .flatMap((root) => walk(root))
      .filter((file) => file !== emitPath)
      .filter((file) => /topic:\s*"notifications"/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
