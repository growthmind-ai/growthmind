import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

import { crontab, taskList } from "../src/index";
import { GRAPHILE_TASK_NAME_PATTERN, TASK } from "../src/task-names";

// Graphile Worker matches jobs to handlers by string name. These tests make the failure
// mode. A queued name with no handler, or a handler nothing can queue. A red test
// instead of a job retrying silently forever.

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

// -- item 105 `crontab` became multi-line when the poll schedule landed. The add marks
// the parser's ability to handle that as an assumed row, pinned here: if a future
// change breaks line-by-line parsing, extend the parser rather than collapsing the cron
// lines back onto one.

test("crontab is multi-line and every line parses into five cron fields plus a task name", () => {
  const lines = crontab.split("\n").filter((line) => line.trim().length > 0);

  expect(lines.length).toBeGreaterThan(1);

  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    // Five schedule fields, then the task identifier. Anything after that is Graphile
    // Worker's own option syntax (`?fill=…`) and is not parsed here.
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
  // Guards the hazard directly: a cron line scheduling `posthog.poll` or a typo'd
  // variant would queue jobs nothing handles, and the set-based test above would still
  // pass if the constant itself had drifted.
  expect(TASK.SESSION_SOURCE_POLL_SCHEDULE).toBe("session-source:poll-schedule");
  expect(crontab).toContain(TASK.SESSION_SOURCE_POLL_SCHEDULE);
  expect(taskList[TASK.SESSION_SOURCE_POLL_SCHEDULE]).toBeDefined();
});

// -- item 106 The agents.md rule, enforced instead of trusted: worker task names are
// exported constants, never raw strings. A raw name in a second place is a name that
// drifts once, and a drifted name is a job queued under something nothing handles,
// retrying silently forever.

const WORKER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK_NAMES_FILE = path.join(WORKER_ROOT, "src", "task-names.ts");

test("no raw task-name string literal appears anywhere in worker/", () => {
  const taskNames = new Set<string>(Object.values(TASK));
  const offenders: string[] = [];

  for (const file of typeScriptFilesUnder(WORKER_ROOT)) {
    // task-names.ts is the one home the literals are allowed to have.
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

/** Comments may discuss a task name freely. The hazard is a name used as a value.
 * Stripping them first is what keeps this test about wiring. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every complete string literal, by value. An exact match against a task name is the
 * violation; a longer message that merely mentions one is not, because it can never be
 * used to register or queue anything. */
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
 * This exists because `session-source.poll-schedule` shipped through a green unit suite
 * and then crashed the worker on boot. "Invalid command specification in line 2 of
 * crontab", because the parser's character set (letter or underscore, then letters,
 * digits, colon, slash, underscore, hyphen) excludes the dot. Nothing below the crontab
 * string had ever been fed to the real parser, so the whole container was the first
 * thing to find out. A name that only fails inside a running container is exactly the
 * stringly-typed hazard task-names.ts warns about.
 */
test("every TASK name parses as a Graphile Worker crontab identifier", () => {
  for (const [key, name] of Object.entries(TASK)) {
    expect(
      GRAPHILE_TASK_NAME_PATTERN.test(name),
      `TASK.${key} = "${name}" is not a valid Graphile Worker identifier — allowed: letter or underscore, then letters digits colon slash underscore hyphen. A dot will crash the worker on boot.`,
    ).toBe(true);
  }
});

// --- O-008 Wave 5 (AD-11, AD-23) --------------------------------------------
// THE ONBOARDING FAST PATH IS THE FIRST QUEUED TASK IN THIS CODEBASE. Every
// other one is cron-triggered, so until now "registered" and "scheduled" were
// the same question. This one is registered and deliberately NOT scheduled, and
// its whole behaviour lives in three values on one `addJob` call — which makes
// it exactly the D9 stringly-typed hazard this file exists for: each of the
// three is a plain string that would compile, run, and be wrong in a way only a
// founder watching a clock would ever notice.
//
// A SOURCE SCAN AND NOT A RUNTIME PROBE, deliberately: `helpers.addJob` needs a
// live Graphile Worker `JobHelpers`, and the values below are arguments rather
// than exported constants — there is nothing on the module to inspect. Each
// scanner ships a PLANTED OFFENDER and a CLEAN CONTROL, so a scanner that
// matched nothing could not report green forever.

const INDEX_FILE = path.join(WORKER_ROOT, "src", "index.ts");

/** Comments discuss the rejected modes BY NAME — that is the point of them — so
 * every scan below runs over code with the comments removed. Scanning the raw
 * file would fail on the clean source for citing what it refuses to do. */
function indexCode(): string {
  return stripComments(readFileSync(INDEX_FILE, "utf8"));
}

/**
 * `preserve_run_at`, and neither of the other two modes.
 *
 * `replace` re-stamps `run_at` FORWARD on every trigger, so a founder producing
 * a burst of broken requests watches the analysis slide away from them on a
 * screen that is showing them a clock. `unsafe_dedupe` was measured against a
 * running holder and DROPS the trigger — losing the late-window failure the
 * whole onboarding surface exists to catch. Only `preserve_run_at` collapses N
 * pending asks into one job that still fires when the FIRST ask arrived.
 */
function preservesRunAt(code: string): boolean {
  return (
    /jobKeyMode:\s*"preserve_run_at"/.test(code) &&
    !/jobKeyMode:\s*"(?:replace|unsafe_dedupe)"/.test(code)
  );
}

/**
 * `addJob`, SINGULAR.
 *
 * graphile-worker's BULK `addJobs` declares `jobKeyMode?: never`, so a later
 * refactor that batched these calls would COMPILE and would silently drop the
 * mode — and with it the collapsing the trigger's entire volume argument rests
 * on. The plural is therefore banned by name rather than trusted not to appear.
 */
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

  // QUEUED, NEVER SCHEDULED. A cron line here would run this task on a timer
  // for every installation — the opposite of a trigger that fires seconds after
  // one founder's own broken request landed, and a second analysis pass nobody
  // asked for.
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
  // The key is what collapses N pending asks for ONE project into one job. A
  // key that omitted the project id would collapse every project's trigger into
  // a single job — one customer's broken request silently swallowing another's
  // — and a key naming the task as a raw string would drift the day the task is
  // renamed, which is the hazard this whole file exists for.
  expect(indexCode()).toContain("jobKey: `${TASK.ANALYSIS_ONBOARDING}:${projectId}`");
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
