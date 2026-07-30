import { expect, test } from "bun:test";

import { crontab, taskList } from "../src/index";
import { TASK } from "../src/task-names";

// Graphile Worker matches jobs to handlers by string name. These tests make
// the failure mode — a queued name with no handler, or a handler nothing can
// queue — a red test instead of a job retrying silently forever.

test("every task name has a registered handler", () => {
  for (const name of Object.values(TASK)) {
    expect(taskList[name]).toBeDefined();
  }
});

test("no handler is registered outside the task-name registry", () => {
  const known = new Set<string>(Object.values(TASK));
  for (const registered of Object.keys(taskList)) {
    expect(known.has(registered)).toBe(true);
  }
});

test("every cron line schedules a known task", () => {
  const known = new Set<string>(Object.values(TASK));
  for (const line of crontab.split("\n")) {
    const scheduledTask = line.trim().split(/\s+/)[5];
    expect(scheduledTask).toBeDefined();
    expect(known.has(scheduledTask as string)).toBe(true);
  }
});
