import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type Kind =
  "keepalive" | "display-clock" | "coalesce" | "animation" | "backoff" | "asks-the-server";

// Polling is forbidden here: the server publishes and the browser listens (lib/live/hub.ts).
// A timer is not automatically a poll. A keepalive on an open stream asks nothing, a clock
// advances a rendered duration, a trailing debounce coalesces events that already arrived, an
// animation runs out a CSS duration, and a backoff waits out a Retry-After before retrying the
// caller's own request. What is banned is a timer that goes and asks whether something happened.
const REVIEWED: Record<string, { readonly kind: Kind; readonly why: string }> = {
  "app/api/live/route.ts": {
    kind: "keepalive",
    why: "writes a comment on the open SSE stream so an idle proxy does not close it; reads nothing",
  },
  "components/first-run/FindingCard.tsx": {
    kind: "animation",
    why: "two one-shot transition timers: one settles the arrival class on the next tick, one runs out the 200ms fold-out that first-run.module.css declares; neither reads anything",
  },
  "components/first-run/FirstRunClient.tsx": {
    kind: "asks-the-server",
    why: "predates the live stream and is the migration backlog: it needs first_run and findings published from every writer behind the status route before the timer can go",
  },
  "components/live/LiveRefresh.tsx": {
    kind: "coalesce",
    why: "a trailing debounce collapsing a burst of pushed events into one refresh; it asks the server nothing and fires only behind an event that already arrived",
  },
  "lib/adapter-deps.ts": {
    kind: "backoff",
    why: "the sleep the PostHog and rrweb clients wait on after a 429 before retrying the request their caller already made; capped by attempts and a deadline, and it never repeats to find out whether something changed",
  },
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === ".next") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

function timerFiles(): string[] {
  return sourceFiles(WEB_ROOT)
    .filter((file) => /setInterval\(|setTimeout\(/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(WEB_ROOT, file).replaceAll("\\", "/"))
    .toSorted();
}

describe("nothing polls", () => {
  test("every timer in the app has been classified", () => {
    expect(timerFiles()).toEqual(Object.keys(REVIEWED).toSorted());
  });

  // The register is what makes the rule hold when nobody is reading it: an unclassified timer
  // fails the test above, and one that admits what it does fails this one.
  test("no timer added from here on asks the server whether something happened", () => {
    const asking = Object.entries(REVIEWED)
      .filter(([, row]) => row.kind === "asks-the-server")
      .map(([file]) => file);

    expect(asking).toEqual(["components/first-run/FirstRunClient.tsx"]);
  });
});
