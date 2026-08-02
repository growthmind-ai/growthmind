import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

import { crontab, taskList } from "../src/index";
import { GRAPHILE_TASK_NAME_PATTERN, TASK } from "../src/task-names";

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

test("crontab is multi-line and every line parses into five cron fields plus a task name", () => {
  const lines = crontab.split("\n").filter((line) => line.trim().length > 0);

  expect(lines.length).toBeGreaterThan(1);

  for (const line of lines) {
    const fields = line.trim().split(/\s+/);

    expect(fields.length).toBeGreaterThanOrEqual(6);
    expect(fields.slice(0, 5).every((field) => field.length > 0)).toBe(true);
  }
});

test("the session-source poll is scheduled exactly once and no task is scheduled twice", () => {
  const scheduled = crontab
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/)[5]);

  expect(scheduled.filter((name) => name === TASK.SESSION_SOURCE_POLL_SCHEDULE).length).toBe(1);
  expect(new Set(scheduled).size).toBe(scheduled.length);
});

test("the scheduled poll name is the exported constant, not a look-alike string", () => {
  expect(TASK.SESSION_SOURCE_POLL_SCHEDULE).toBe("session-source:poll-schedule");
  expect(crontab).toContain(TASK.SESSION_SOURCE_POLL_SCHEDULE);
  expect(taskList[TASK.SESSION_SOURCE_POLL_SCHEDULE]).toBeDefined();
});

const WORKER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK_NAMES_FILE = path.join(WORKER_ROOT, "src", "task-names.ts");

test("no raw task-name string literal appears anywhere in worker/", () => {
  const taskNames = new Set<string>(Object.values(TASK));
  const offenders: string[] = [];

  for (const file of typeScriptFilesUnder(WORKER_ROOT)) {
    if (path.resolve(file) === path.resolve(TASK_NAMES_FILE)) continue;

    if (path.resolve(file) === path.resolve(fileURLToPath(import.meta.url))) continue;

    const source = stripComments(readFileSync(file, "utf8"));
    for (const literal of stringLiteralsIn(source)) {
      if (taskNames.has(literal)) {
        offenders.push(`${path.relative(WORKER_ROOT, file)}: ${JSON.stringify(literal)}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

function typeScriptFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...typeScriptFilesUnder(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stringLiteralsIn(source: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\$\n]*)`/g;
  let match = pattern.exec(source);
  while (match !== null) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
    match = pattern.exec(source);
  }
  return out;
}

test("every TASK name parses as a Graphile Worker crontab identifier", () => {
  for (const [key, name] of Object.entries(TASK)) {
    expect(
      GRAPHILE_TASK_NAME_PATTERN.test(name),
      `TASK.${key} = "${name}" is not a valid Graphile Worker identifier — allowed: letter or underscore, then letters digits colon slash underscore hyphen. A dot will crash the worker on boot.`,
    ).toBe(true);
  }
});

const INDEX_FILE = path.join(WORKER_ROOT, "src", "index.ts");

function indexCode(): string {
  return stripComments(readFileSync(INDEX_FILE, "utf8"));
}

function preservesRunAt(code: string): boolean {
  return (
    /jobKeyMode:\s*"preserve_run_at"/.test(code) &&
    !/jobKeyMode:\s*"(?:replace|unsafe_dedupe)"/.test(code)
  );
}

function queuesOneAtATime(code: string): boolean {
  return /\baddJob\(/.test(code) && !/\baddJobs\b/.test(code);
}

const PLANTED_BULK_ENQUEUE = `
  await helpers.addJobs([
    { identifier: TASK.ANALYSIS_ONBOARDING, payload: { projectId } },
  ]);
`;

const PLANTED_DEDUPE_MODE = `
  await helpers.addJob(TASK.ANALYSIS_ONBOARDING, { projectId }, {
    jobKey: key,
    jobKeyMode: "unsafe_dedupe",
  });
`;

const PLANTED_REPLACE_MODE = `
  await helpers.addJob(TASK.ANALYSIS_ONBOARDING, { projectId }, {
    jobKey: key,
    jobKeyMode: "replace",
  });
`;

const CLEAN_ENQUEUE = `
  await helpers.addJob(TASK.ANALYSIS_ONBOARDING, { projectId }, {
    jobKey: key,
    jobKeyMode: "preserve_run_at",
  });
`;

test("the onboarding analysis task is registered and is deliberately never cronned", () => {
  expect(taskList[TASK.ANALYSIS_ONBOARDING]).toBeDefined();

  const scheduled = crontab
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/)[5]);

  expect(scheduled).not.toContain(TASK.ANALYSIS_ONBOARDING);
});

test("the onboarding trigger enqueues one job at a time, never the bulk API", () => {
  expect(queuesOneAtATime(PLANTED_BULK_ENQUEUE)).toBe(false);
  expect(queuesOneAtATime(CLEAN_ENQUEUE)).toBe(true);

  expect(queuesOneAtATime(indexCode())).toBe(true);
});

test("the onboarding trigger queues under preserve_run_at, never replace and never unsafe_dedupe", () => {
  expect(preservesRunAt(PLANTED_DEDUPE_MODE)).toBe(false);
  expect(preservesRunAt(PLANTED_REPLACE_MODE)).toBe(false);
  expect(preservesRunAt(CLEAN_ENQUEUE)).toBe(true);

  expect(preservesRunAt(indexCode())).toBe(true);
});

test("the onboarding job key is built from the task constant and the project id", () => {
  expect(indexCode()).toContain("jobKey: `${TASK.ANALYSIS_ONBOARDING}:${projectId}`");
});

test("every crontab line's command is a registered, well-formed task name", () => {
  const registered = new Set(Object.keys(taskList));

  for (const [index, line] of crontab.split("\n").entries()) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const command = line.trim().split(/\s+/)[5];
    expect(command, `crontab line ${index + 1} has no command`).toBeDefined();
    expect(
      GRAPHILE_TASK_NAME_PATTERN.test(command ?? ""),
      `crontab line ${index + 1} command "${command}" is not a valid identifier`,
    ).toBe(true);
    expect(
      registered.has(command ?? ""),
      `crontab line ${index + 1} schedules "${command}", which no registered task handles — it would retry forever`,
    ).toBe(true);
  }
});
