import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type Kind = "keepalive" | "display-clock" | "asks-the-server";

// Polling is forbidden here. The server publishes and the browser listens — see
// lib/live/hub.ts and components/live/LiveRefresh.tsx.
//
// A timer is not automatically a poll: a keepalive comment on an already-open stream asks
// nothing, and a clock that advances a rendered duration reads no server. What is banned is
// a timer that goes and asks whether something happened.
const REVIEWED: Record<string, { readonly kind: Kind; readonly why: string }> = {
  "app/api/live/route.ts": {
    kind: "keepalive",
    why: "writes a comment on the open SSE stream so an idle proxy does not close it; reads nothing",
  },
  "components/first-run/FirstRunClient.tsx": {
    kind: "asks-the-server",
    why: "predates the live stream and is the migration backlog: it needs first_run and findings published from every writer behind the status route before the timer can go",
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
    .filter((file) => /setInterval\(/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(WEB_ROOT, file).replaceAll("\\", "/"))
    .toSorted();
}

describe("nothing polls", () => {
  test("every repeating timer in the app has been classified", () => {
    expect(timerFiles()).toEqual(Object.keys(REVIEWED).toSorted());
  });

  // The register is what makes the rule hold when nobody is reading it. A new timer that
  // asks the server fails the test above until someone writes down why, and this one the
  // moment they admit what it does.
  test("no timer added from here on asks the server whether something happened", () => {
    const asking = Object.entries(REVIEWED)
      .filter(([, row]) => row.kind === "asks-the-server")
      .map(([file]) => file);

    expect(asking).toEqual(["components/first-run/FirstRunClient.tsx"]);
  });
});
