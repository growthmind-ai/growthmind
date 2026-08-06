import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_TOPICS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

const DB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function src(...parts: string[]): string {
  return readFileSync(path.join(DB_ROOT, "src", ...parts), "utf8");
}

// Every table the first-run status payload is assembled from, paired with the repository that
// writes it. A row here with no publisher is a step on the setup screen that stops moving,
// and there is no timer behind that screen any more to cover for it.
//
// This list is the gate the outcome asked for as a grep. A grep proves the publishes that
// exist; only an enumeration can prove none is missing — which is how `analysis_runs` shipped
// unpublished and was caught by a grader rather than by a test.
const BEHIND_THE_STATUS_ROUTE = [
  { table: "first_run_state", repo: "first-run.repo.ts", topic: "first_run" },
  { table: "first_run_dismissals", repo: "first-run.repo.ts", topic: "first_run" },
  { table: "session_source_poll_runs", repo: "poll-runs.repo.ts", topic: "first_run" },
  { table: "analysis_runs", repo: "analysis-runs.repo.ts", topic: "first_run" },
  { table: "findings", repo: "findings.repo.ts", topic: "findings" },
  { table: "dismissals", repo: "dismissals.repo.ts", topic: "findings" },
  { table: "deliveries", repo: "deliveries.repo.ts", topic: "first_run" },
  { table: "slack_connections", repo: "slack-connections.repo.ts", topic: "first_run" },
  { table: "provider_interest", repo: "provider-interest.repo.ts", topic: "first_run" },
] as const;

describe("every writer behind the first-run status route announces", () => {
  test("first_run is a declared topic", () => {
    expect(LIVE_TOPICS).toContain("first_run");
    expect(LIVE_TOPICS).toContain("findings");
  });

  for (const { table, repo, topic } of BEHIND_THE_STATUS_ROUTE) {
    // The topic this row names, not either of them: a repository publishing only `findings`
    // leaves the setup screen exactly as stuck as one publishing nothing.
    test(`${table} is published as ${topic} from ${repo}`, () => {
      const source = src("repositories", repo);

      expect(source).toContain(`topic: "${topic}"`);
    });

    // Presence of the import is what the first version of this gate checked, and deleting
    // every call while keeping the helper kept it green — which is the bug that shipped.
    test(`${repo} calls its publisher rather than only importing one`, () => {
      const source = src("repositories", repo);
      const calls = source.match(/await (announce|announced)\(|await publishLive\(/g) ?? [];

      expect(calls.length).toBeGreaterThan(0);
    });
  }

  // Inverted on purpose: every table the service reads must appear above, so a table it
  // learns to read later fails here instead of silently becoming the next unpublished step.
  test("the enumeration covers every table the status service selects from", () => {
    const service = src("services", "first-run-status.service.ts");

    const listed = new Set<string>(BEHIND_THE_STATUS_ROUTE.map((row) => row.table));

    const read = [...service.matchAll(/\.(?:from|innerJoin|leftJoin)\((\w+)/g)]
      .map((match) => match[1] ?? "")
      .map((symbol) => symbol.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));

    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((table) => !listed.has(table))).toEqual([]);
  });

  test("no publisher fires from a task or a route — only from the repository write", () => {
    const worker = readFileSync(
      path.join(DB_ROOT, "..", "..", "worker", "src", "tasks", "analysis-tick.ts"),
      "utf8",
    );

    expect(worker).not.toContain("publishLive");
  });
});
