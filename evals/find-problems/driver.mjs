// Runs under Node, never bun: see browser.mjs. Speaks newline-delimited JSON on stdio so the
// persona brain can live in typed bun code on this repo's own model lane while Playwright
// stays in a Node host. stdout carries protocol lines only; diagnostics go to stderr.

import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

import { openRecordedPage, readRecording, observePage } from "./browser.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const url = arg("url", "http://localhost:3000/sign-in");
const outDir = arg("out-dir", "runs/session");
const width = Number(arg("width", "1280"));
const height = Number(arg("height", "800"));
const settleMs = Number(arg("settle-ms", "900"));

mkdirSync(outDir, { recursive: true });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = createInterface({ input: process.stdin });
const pending = [];
let waiting = null;

lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  const parsed = JSON.parse(trimmed);
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(parsed);
    return;
  }
  pending.push(parsed);
});

function nextCommand() {
  const queued = pending.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    waiting = resolve;
  });
}

const { browser, page, consoleErrors } = await openRecordedPage({ url, width, height });

const performed = [];
let step = 0;
let handles = [];

async function emitObservation() {
  step += 1;
  await page.waitForTimeout(settleMs);
  const observed = await observePage(page);
  handles = observed.handles;

  const screenshotPath = join(outDir, `step-${String(step).padStart(2, "0")}.png`);
  await page.screenshot({ path: screenshotPath }).catch(() => null);

  send({
    type: "observation",
    step,
    url: observed.url,
    title: observed.title,
    headings: observed.headings,
    visibleText: observed.visibleText,
    elements: observed.elements,
    screenshotPath,
    consoleErrorCount: consoleErrors.length,
  });
}

async function act(command) {
  const target =
    typeof command.elementIndex === "number" ? (handles[command.elementIndex] ?? null) : null;

  if (command.action === "click") {
    if (target === null) throw new Error(`no element at index ${String(command.elementIndex)}`);
    await target.click({ timeout: 5000 });
    return;
  }

  if (command.action === "type") {
    if (target === null) throw new Error(`no element at index ${String(command.elementIndex)}`);
    await target.click({ timeout: 5000 });
    await page.keyboard.type(String(command.text ?? ""), { delay: 45 });
    return;
  }

  if (command.action === "press_enter") {
    await page.keyboard.press("Enter");
    return;
  }

  if (command.action === "scroll") {
    await page.mouse.wheel(0, Number(command.scrollBy ?? 600));
    return;
  }

  if (command.action === "back") {
    // A real back button is greyed out on the first page of a visit. Without this, one back
    // strands the persona on about:blank and every later step is spent on a blank screen.
    const before = page.url();
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
    if (page.url() === "about:blank" || page.url() === "") {
      await page.goto(before, { waitUntil: "domcontentloaded" });
      throw new Error("there is nothing to go back to");
    }
    return;
  }

  if (command.action === "wait") {
    await page.waitForTimeout(1200);
    return;
  }

  throw new Error(`unknown action ${String(command.action)}`);
}

try {
  await emitObservation();

  for (;;) {
    const command = await nextCommand();

    if (command.type === "finish") {
      break;
    }

    if (command.type !== "act") {
      send({ type: "error", message: `unknown command ${String(command.type)}` });
      continue;
    }

    const attempt = {
      step,
      action: command.action,
      elementIndex: command.elementIndex ?? null,
      text: command.text ?? null,
      ok: true,
      error: null,
    };

    try {
      await act(command);
    } catch (error) {
      attempt.ok = false;
      attempt.error = String(error).split("\n")[0];
    }

    performed.push(attempt);
    send({ type: "acted", ...attempt });
    await emitObservation();
  }

  const { recordError, events } = await readRecording(page);
  const sessionPath = join(outDir, "session.json");
  writeFileSync(
    sessionPath,
    JSON.stringify({
      url,
      finalUrl: page.url(),
      recordError,
      consoleErrors,
      performed,
      events,
    }),
  );

  send({
    type: "final",
    sessionPath,
    finalUrl: page.url(),
    recordError,
    eventCount: events.length,
    consoleErrors,
  });
} catch (error) {
  send({ type: "error", message: String(error).split("\n")[0] });
  process.exitCode = 1;
} finally {
  await browser.close();
  lines.close();
}
