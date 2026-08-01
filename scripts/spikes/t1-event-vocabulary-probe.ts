#!/usr/bin/env bun
/**
 * T1 event-vocabulary probe, the re-runnable instrument for.
 *
 * resolved Addendum A against a project holding 220 events, all of them written by this
 * repo's own spikes and none originating from a browser SDK. Rows …
 * (`$rageclick`, `$dead_click`/`$dead_swipe`, `$autocapture`, `$pageview`) came back
 * `FAILED-TO-PIN`, not because nobody looked hard enough, but because that corpus could
 * not have contained them in principle. `rage_click`, `dead_click` and
 * `form_abandonment` are therefore not built: a detector is never built on an
 * assumption.
 *
 * This script exists so those rows can be lifted later without rebuilding an
 * instrument. Point it at a project a real `posthog-js` page has touched and re-run it;
 * the day returns `PINNED — present`, `rage_click` becomes a small follow-up
 * sprint.
 *
 * Row `$exception` → `error_event` (already built)
 * Row `$rageclick` → `rage_click`
 * Row `$dead_click` / `$dead_swipe` → `dead_click`
 * Row `$autocapture` → the barred proxy
 * Row `$pageview` → nothing depends on it
 *
 * **scope: event names only**. This probe never reads event properties, and two rows
 * must not be over-read on account of it:
 * 's sub-question ("does it carry `$exception_list`, and in what shape")
 *  is already settled in by round-trip and is not re-tested here.
 *  `error_event` keys on the name, which is all this probe reports.
 * 's sub-question ("is `$pathname`/`$current_url` usable") is
 *  unanswerable from live data, and removed `funnel_dropoff`'s
 *  dependency on `$pageview` entirely — the adapter reads the path off
 *  Every event. A `PINNED — present` on therefore unblocks nothing on
 *  its own; it is measured because the row exists in the table, not
 *  because a detector is waiting on it.
 *
 * Method: Read-only. Unlike `posthog-shape-probe.ts` this script writes NO synthetic
 * events. Planting its own data is the one thing that would destroy the measurement,
 * since the question is precisely "what does traffic that is not ours look like". It
 * cursor-walks the events list API over the requested window, builds an event-name
 * histogram carrying its denominator, judges whether the sample is representative of
 * real browser traffic at all, and only then lets a row be called absent.
 *
 * **The one rule.** Zero observations of a browser event in a corpus with zero
 * browser-originated events is `FAILED-TO-PIN`, never `PINNED — absent`. The
 * representativeness judgement gates the absent verdict structurally. See
 * `lib/t1-vocabulary.ts`, where the absent arm of `RowVerdict` cannot be constructed
 * without a `RepresentativeSample`.
 *
 * Usage: bun scripts/spikes/t1-event-vocabulary-probe.ts [flags]
 *
 * Flags:
 * -days <n> window to read back, in days (default 30)
 * -limit <n> page size for the cursor walk (default 500)
 * -max-pages <n> hard bound on pages walked (default 40)
 *
 * Required env (repo-root `.env`): POSTHOG_HOST, POSTHOG_PROJECT_API_KEY,
 * POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID. Read-only, but point them at whichever
 * project actually carries the browser traffic you want measured.
 *
 * Public repo: no key material, project id, or customer identifier may appear in this
 * file, in stdout, or in the run file. Every printed line and the serialised report
 * both pass through `lib/redact.ts`. Event names are customer-authored strings and are
 * treated as untrusted text.
 *
 * Output: `local/spikes/t1-event-vocabulary-<iso>.json` (gitignored, nothing from
 * `local/spikes/` is ever committed).
 *
 * Exit codes: 0 = the probe completed and every row carries a verdict on its own line
 * (a `FAILED-TO-PIN` row is a completed probe, not a failed one); 1 = the credential
 * gate failed or no page was readable, so nothing could be judged at all.
 */

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

// Constants, no raw cross-boundary string at a call site

const DEFAULT_WINDOW_DAYS = 30;
/** Page size for the walk. The shape probe pinned the api's own ceiling. */
const DEFAULT_PAGE_SIZE = 500;
/**
 * Hard bound on pages. A bound reached is reported as a truncated sample rather than
 * passed off as the whole corpus. The That decision was a silent truncation that read
 * as "no more events", which here would read as an absence.
 */
const DEFAULT_MAX_PAGES = 40;
/** Politeness floor between reads (decision 0001: 1000 ms drew 2,162 429s). */
const POLITE_INTERVAL_MS = 1_200;

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** Where the run file lands. Gitignored; never committed. */
const OUTPUT_DIR = join("local", "spikes");

// Flags

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

// Impure shell

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function section(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

/** The redaction-bound printer. Nothing reaches stdout except through this. */
function printer(secrets: RedactionSecrets): (line: string) => void {
  return (line: string): void => {
    console.log(redactSecrets(line, secrets));
  };
}

/** First page url: the window is an explicit `after`, never an implicit default. */
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
  /** True when the page bound stopped the walk. A stated limit, never silent. */
  readonly truncated: boolean;
}

/**
 * Cursor-walks the events list API. Stops on a null `next`, on the page bound, or on
 * the first page that returns nothing, and reports which, so a short sample is never
 * mistaken for a complete one.
 */
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
      // A failed read is not an empty project. Say so on the page it happened, because
      // from here on the sample is short and a short sample must never be read as an
      // absence (status 0 = the request never got a response).
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

/** Writes the run file, redacted, under gitignored local/spikes/. */
async function writeReport(report: VocabularyReport, secrets: RedactionSecrets): Promise<string> {
  const startedAt = new Date().toISOString().replaceAll(":", "-");
  const path = join(OUTPUT_DIR, `t1-event-vocabulary-${startedAt}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, redactSecrets(JSON.stringify(report, null, 2), secrets), "utf8");
  return path;
}

// Entrypoint

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
    // An auth failure is a read failure, never a failed-to-pin row: a row implies the
    // sample was judged, and nothing was read to judge (ruling 10).
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
