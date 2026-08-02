#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { eventsUrl } from "./lib/constants";
import { formatCredentialError, validateCredentials, type Credentials } from "./lib/env";
import { fetchEventsPage } from "./lib/posthog-client";
import { redactSecrets, type RedactionSecrets } from "./lib/redact";
import {
  CURRENT_REPRESENTATIVENESS_RULES,
  VOCABULARY_ROWS,
  buildVocabularyReport,
  formatVerdictLine,
  toObservedEvents,
  type VocabularyReport,
} from "./lib/t1-vocabulary";

const DEFAULT_WINDOW_DAYS = 30;

const DEFAULT_PAGE_SIZE = 500;

const DEFAULT_MAX_PAGES = 40;

const POLITE_INTERVAL_MS = 1_200;

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

const OUTPUT_DIR = join("local", "spikes");

interface Flags {
  readonly windowDays: number;
  readonly pageSize: number;
  readonly maxPages: number;
}

function int(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFlags(argv: readonly string[]): Flags {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    windowDays: int(read("--days"), DEFAULT_WINDOW_DAYS),
    pageSize: int(read("--limit"), DEFAULT_PAGE_SIZE),
    maxPages: int(read("--max-pages"), DEFAULT_MAX_PAGES),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function section(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

function printer(secrets: RedactionSecrets): (line: string) => void {
  return (line: string): void => {
    console.log(redactSecrets(line, secrets));
  };
}

function firstPageUrl(creds: Credentials, since: Date, pageSize: number): string {
  const params = new URLSearchParams({
    limit: String(pageSize),
    after: since.toISOString(),
  });
  return `${eventsUrl(creds.host, creds.projectId)}?${params.toString()}`;
}

interface SampleRead {
  readonly rawItems: readonly unknown[];
  readonly pagesWalked: number;

  readonly truncated: boolean;
}

async function readSample(
  creds: Credentials,
  since: Date,
  flags: Flags,
  log: (line: string) => void,
): Promise<SampleRead> {
  const rawItems: unknown[] = [];
  let url: string | null = firstPageUrl(creds, since, flags.pageSize);
  let pagesWalked = 0;

  while (url !== null && pagesWalked < flags.maxPages) {
    const page = await fetchEventsPage(creds, url);
    pagesWalked++;
    rawItems.push(...page.items);
    log(`  page ${pagesWalked}: status=${page.status} items=${page.items.length}`);
    if (page.status < 200 || page.status >= 300) {
      log(
        `  WARNING: page ${pagesWalked} did not read (status=${page.status}) — the walk stops ` +
          `here, so this sample is SHORT and cannot support an absence claim`,
      );
    }
    url = page.next;
    if (url !== null) await sleep(POLITE_INTERVAL_MS);
  }

  const truncated = url !== null;
  if (truncated) {
    log(
      `  WARNING: stopped at the ${flags.maxPages}-page bound with more pages available — ` +
        `this sample is TRUNCATED, so any absence it reports is not the whole window`,
    );
  }
  return { rawItems, pagesWalked, truncated };
}

async function writeReport(report: VocabularyReport, secrets: RedactionSecrets): Promise<string> {
  const startedAt = new Date().toISOString().replaceAll(":", "-");
  const path = join(OUTPUT_DIR, `t1-event-vocabulary-${startedAt}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, redactSecrets(JSON.stringify(report, null, 2), secrets), "utf8");
  return path;
}

async function main(): Promise<number> {
  const flags = parseFlags(Bun.argv.slice(2));

  const gate = validateCredentials(process.env);
  if (!gate.ok) {
    console.error(formatCredentialError(gate.missing));
    return 1;
  }
  const { creds } = gate;
  const secrets: RedactionSecrets = {
    personalApiKey: creds.personalApiKey,
    projectApiKey: creds.projectApiKey,
    projectId: creds.projectId,
  };
  const log = printer(secrets);

  section("T1 event-vocabulary probe (O-004 FR-21) — READ-ONLY, writes no events");
  log(`  host region: ${new URL(creds.host).hostname.split(".")[0] ?? "unknown"}`);
  log(`  window: last ${flags.windowDays} day(s), page size ${flags.pageSize}`);
  log(
    `  representativeness bar: >= ${CURRENT_REPRESENTATIVENESS_RULES.minimumBrowserOriginatedEvents} ` +
      `browser-originated events, $lib in ` +
      `${JSON.stringify(CURRENT_REPRESENTATIVENESS_RULES.browserOriginLibs)}`,
  );

  const since = new Date(Date.now() - flags.windowDays * MS_PER_DAY);

  let read: SampleRead;
  try {
    read = await readSample(creds, since, flags, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      redactSecrets(
        `${message}\nno events were readable — this is NOT an absence result: an unreadable ` +
          "sample says nothing about the client's vocabulary.",
        secrets,
      ),
    );
    return 1;
  }

  if (read.rawItems.length === 0) {
    console.error(
      "no events were readable in the window — nothing could be judged. This is NOT an " +
        "absence result: an unreadable sample says nothing about the client's vocabulary.",
    );
    return 1;
  }

  const sample = toObservedEvents(read.rawItems);
  const report = buildVocabularyReport(sample, VOCABULARY_ROWS, CURRENT_REPRESENTATIVENESS_RULES);

  section("HISTOGRAM");
  log(`  denominator: ${report.histogram.denominator} event(s) over ${read.pagesWalked} page(s)`);
  for (const entry of report.histogram.counts) {
    log(`    ${entry.count} / ${report.histogram.denominator}  ${entry.name}`);
  }

  section("REPRESENTATIVENESS — the gate on every absent verdict");
  const { representativeness } = report;
  log(`  ${representativeness.kind}`);
  log(
    `  browser-originated: ${representativeness.basis.browserOriginatedEvents} / ` +
      `${representativeness.basis.totalEvents} (bar: ` +
      `${representativeness.basis.minimumBrowserOriginatedEvents})`,
  );
  log(`  $lib values observed: ${JSON.stringify(representativeness.basis.observedLibs)}`);
  log(
    "  The allow-list above is REASONED, not measured (ruling 11): a $lib it has not learned is " +
      "not counted as browser traffic. Read the observed list and confirm it before trusting " +
      "ANY absent verdict — an unrecognised real client `$lib` shows up here as a shortfall.",
  );
  if (representativeness.kind === "not_representative") {
    log(
      `  → ${representativeness.reason}: no row may be called absent against this sample. ` +
        `Point the credentials at a project a real posthog-js page has touched and re-run.`,
    );
  }

  section("VERDICTS");
  for (const verdict of report.verdicts) log(formatVerdictLine(verdict));
  log(
    "\n  Scope (ruling 8): these verdicts are about event NAMES only — no event property was " +
      "read. A-1 does not re-test the `$exception_list` payload (settled in ADD §2 by " +
      "round-trip; `error_event` keys on the name). A-5 does not answer the " +
      "`$pathname`/`$current_url` sub-question at all, and D-18 removed `funnel_dropoff`'s " +
      "dependency on `$pageview`, so A-5 unblocks nothing on its own.",
  );

  const path = await writeReport(report, secrets);
  log(`\n  run file: ${path}`);
  return 0;
}

process.exit(await main());
