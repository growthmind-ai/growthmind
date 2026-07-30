import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

import { crontab, taskList } from "../src/index";
import { GRAPHILE_TASK_NAME_PATTERN, TASK } from "../src/task-names";

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

// --- O-003 §9 item 105 ------------------------------------------------------
// `crontab` became MULTI-LINE when the poll schedule landed. The ADD marks the
// parser's ability to handle that as an ASSUMED row, pinned here: if a future
// change breaks line-by-line parsing, extend the parser rather than collapsing
// the cron lines back onto one.

test("crontab is multi-line and every line parses into five cron fields plus a task name", () => {
  const lines = crontab.split("\n").filter((line) => line.trim().length > 0);

  expect(lines.length).toBeGreaterThan(1);

  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    // Five schedule fields, then the task identifier. Anything after that is
    // Graphile Worker's own option syntax (`?fill=…`) and is not parsed here.
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
  // Guards the D9 hazard directly: a cron line scheduling `posthog.poll` or a
  // typo'd variant would queue jobs nothing handles, and the set-based test
  // above would still pass if the constant itself had drifted.
  expect(TASK.SESSION_SOURCE_POLL_SCHEDULE).toBe("session-source:poll-schedule");
  expect(crontab).toContain(TASK.SESSION_SOURCE_POLL_SCHEDULE);
  expect(taskList[TASK.SESSION_SOURCE_POLL_SCHEDULE]).toBeDefined();
});

// --- O-003 §9 item 106 ------------------------------------------------------
// The AGENTS.md rule, enforced instead of trusted: worker task names are
// exported constants, never raw strings. A raw name in a second place is a
// name that drifts once — and a drifted name is a job queued under something
// nothing handles, retrying silently forever.

const WORKER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK_NAMES_FILE = path.join(WORKER_ROOT, "src", "task-names.ts");

test("no raw task-name string literal appears anywhere in worker/", () => {
  const taskNames = new Set<string>(Object.values(TASK));
  const offenders: string[] = [];

  for (const file of typeScriptFilesUnder(WORKER_ROOT)) {
    // task-names.ts is the ONE home the literals are allowed to have.
    if (path.resolve(file) === path.resolve(TASK_NAMES_FILE)) continue;
    // This file necessarily names one to assert the constant's value above.
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

/** Comments may discuss a task name freely — the hazard is a name used as a
 * VALUE. Stripping them first is what keeps this test about wiring. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every complete string literal, by value. An exact match against a task name
 * is the violation; a longer message that merely mentions one is not, because
 * it can never be used to register or queue anything. */
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

/**
 * Every task name must satisfy Graphile Worker's crontab identifier grammar.
 *
 * This exists because `session-source.poll-schedule` shipped through a green
 * unit suite and then crashed the worker ON BOOT — "Invalid command
 * specification in line 2 of crontab" — because the parser's character set
 * (letter or underscore, then letters, digits, colon, slash, underscore, hyphen) excludes the dot. Nothing below the crontab
 * string had ever been fed to the real parser, so the whole container was the
 * first thing to find out. A name that only fails inside a running container
 * is exactly the D9 stringly-typed hazard task-names.ts warns about.
 */
test("every TASK name parses as a Graphile Worker crontab identifier", () => {
  for (const [key, name] of Object.entries(TASK)) {
    expect(
      GRAPHILE_TASK_NAME_PATTERN.test(name),
      `TASK.${key} = "${name}" is not a valid Graphile Worker identifier — allowed: letter or underscore, then letters digits colon slash underscore hyphen. A dot will crash the worker on boot.`,
    ).toBe(true);
  }
});

test("every crontab line's command is a registered, well-formed task name", () => {
  const registered = new Set(Object.keys(taskList));

  for (const [index, line] of crontab.split("\n").entries()) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    // 5 time fields, then the command, then optional ?opts / {payload}.
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
