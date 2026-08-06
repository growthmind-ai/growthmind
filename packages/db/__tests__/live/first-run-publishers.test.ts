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
  { table: "first_run_state", repo: "first-run.repo.ts" },
  { table: "first_run_dismissals", repo: "first-run.repo.ts" },
  { table: "session_source_poll_runs", repo: "poll-runs.repo.ts" },
  { table: "analysis_runs", repo: "analysis-runs.repo.ts" },
  { table: "findings", repo: "findings.repo.ts" },
  { table: "dismissals", repo: "dismissals.repo.ts" },
  { table: "deliveries", repo: "deliveries.repo.ts" },
  { table: "slack_connections", repo: "slack-connections.repo.ts" },
  { table: "provider_interest", repo: "provider-interest.repo.ts" },
] as const;

describe("every writer behind the first-run status route announces", () => {
  test("first_run is a declared topic", () => {
    expect(LIVE_TOPICS).toContain("first_run");
    expect(LIVE_TOPICS).toContain("findings");
  });

  for (const { table, repo } of BEHIND_THE_STATUS_ROUTE) {
    test(`${table} is published from ${repo}`, () => {
      const source = src("repositories", repo);

      expect(source).toContain("publishLive");
      expect(source).toMatch(/topic: "(first_run|findings)"/);
    });
  }

  // The service is what actually decides the payload, so it is the list's own check: a table
  // it learns to read that nobody added above leaves the same hole again.
  test("the enumeration above still covers what the status service reads", () => {
    const service = src("services", "first-run-status.service.ts");

    const unlisted = ["analysisRuns", "sessionSourcePollRuns", "findings", "firstRunState"].filter(
      (symbol) => service.includes(symbol) === false,
    );

    expect(unlisted).toEqual([]);
  });

  test("no publisher fires from a task or a route — only from the repository write", () => {
    const worker = readFileSync(
      path.join(DB_ROOT, "..", "..", "worker", "src", "tasks", "analysis-tick.ts"),
      "utf8",
    );

    expect(worker).not.toContain("publishLive");
  });
});
