// Runs under Node, never bun: Playwright's pipe transport needs child_process stdio fds
// that bun does not wire on Windows, so a bun-hosted launch hangs at the CDP handshake.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);

const RECORD_BUNDLE = readFileSync(
  join(dirname(require.resolve("@rrweb/record")), "record.umd.min.cjs"),
  "utf8",
);

// `.call(window)` so the UMD wrapper takes its global branch rather than looking for module.
export const RECORD_INIT_SCRIPT = `(function(){${RECORD_BUNDLE}}).call(window);
  (() => {
    if (window.__gmRecording) return;
    window.__gmRecording = true;
    window.__gmEvents = [];
    const api = window.rrwebRecord;
    const record = typeof api === "function" ? api : api && api.record;
    if (typeof record !== "function") { window.__gmRecordError = "record export not found"; return; }
    record({ emit: (event) => { window.__gmEvents.push(event); } });
  })();
`;

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
].join(", ");

const NAME_LIMIT = 90;
const TEXT_LIMIT = 1400;
const MAX_ELEMENTS = 40;

export async function openRecordedPage({ url, width, height }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  // The page a console error came from, because a persona sent off to an identity provider
  // produces that site's errors, and those are never evidence about our product.
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push({ message: message.text(), url: page.url() });
  });
  page.on("pageerror", (error) => consoleErrors.push({ message: error.message, url: page.url() }));

  await page.addInitScript(RECORD_INIT_SCRIPT);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  return { browser, context, page, consoleErrors };
}

export async function readRecording(page) {
  const recordError = await page.evaluate(() => window.__gmRecordError ?? null);
  const events = await page.evaluate(() => window.__gmEvents ?? []);
  return { recordError, events };
}

const describeOne = (el) => {
  const attr = (name) => el.getAttribute(name) ?? null;
  const labelled = el.labels && el.labels.length > 0 ? el.labels[0].innerText : null;
  const name =
    attr("aria-label") ??
    labelled ??
    (el.innerText || "").trim() ??
    attr("placeholder") ??
    attr("title") ??
    attr("alt") ??
    "";

  return {
    tag: el.tagName.toLowerCase(),
    inputType: attr("type"),
    role: attr("role"),
    name: String(name || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90),
    placeholder: attr("placeholder"),
    href: attr("href"),
    hasValue: "value" in el && String(el.value ?? "").length > 0,
    disabled: el.disabled === true || attr("aria-disabled") === "true",
  };
};

export async function observePage(page) {
  const handles = [];
  const elements = [];

  for (const handle of await page.$$(INTERACTIVE_SELECTOR)) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (!(await handle.isVisible().catch(() => false))) continue;
    const described = await handle.evaluate(describeOne).catch(() => null);
    if (described === null) continue;
    elements.push({ index: handles.length, ...described });
    handles.push(handle);
  }

  const page_ = await page.evaluate((limit) => {
    const headings = [...document.querySelectorAll("h1, h2, h3")]
      .map((node) => node.innerText.replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0)
      .slice(0, 12);
    const body = document.body ? document.body.innerText.replace(/\s+/g, " ").trim() : "";
    return { title: document.title, headings, visibleText: body.slice(0, limit) };
  }, TEXT_LIMIT);

  return { handles, elements, url: page.url(), ...page_ };
}

export const LIMITS = { NAME_LIMIT, TEXT_LIMIT, MAX_ELEMENTS };
