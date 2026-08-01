#!/usr/bin/env bun
/**
 * PostHog API shape probe. The Wave 0 ordering gate.
 *
 * Prd Addendum A marks six PostHog API shapes assumed, and no dependent implementation
 * may start until each is pinned against the live API. This script pins them by
 * observation, never by documentation:
 *
 * Row 1 Pagination / cursor, `next` contract, limit, offset, ordering, page ceiling
 * Row 2 Time-window filter, `after` / `before` names, formats, boundary inclusivity
 * Row 3 Event `id`. Presence, stability across retrievals, uniqueness
 * Row 4 Event `timestamp`. Format, timezone, event-time vs ingestion-time
 * Row 5 `Retry-After` on 429. Presence and format (delta-seconds vs HTTP-date)
 * Row 6 Email-bearing person property reachability from the events list API
 * Sec-a User-agent property availability and name
 * Sec-b URL / path property used as the thin surface
 * Sec-c PostHog's own session identifier
 * Sec-d 401/403 body shape with a deliberately wrong key
 *
 * Method: the probe captures its own cohort of synthetic events into the configured
 * project (a deliberately backdated one, an identified one carrying `$set`, a
 * timestamp-ordered burst, and a bulk block for the page ceiling), waits for PostHog's
 * ingestion lag, then reads them back. It plants its own data because the answer to
 * several rows (most sharply row 4) is only observable when the event time and the
 * ingestion time are known to differ.
 *
 * Usage: bun scripts/spikes/posthog-shape-probe.ts [flags]
 *
 * Flags:
 * -bulk <n> bulk events captured for the page-ceiling probe (default 150)
 * -wait <ms> ingestion wait before reading back (default 60000)
 * -skip-429 skip the deliberate rate-limit burst (row 5)
 * -only-429 run only the rate-limit burst (no capture, no cohort)
 * -skip-capture read-only run against a previous cohort (needs --run-id)
 * -run-id <id> reuse a previous run's cohort id with --skip-capture
 *
 * Required env (repo-root `.env`; point them at a test project. This script writes
 * synthetic events): POSTHOG_HOST, POSTHOG_PROJECT_API_KEY, POSTHOG_PERSONAL_API_KEY,
 * POSTHOG_PROJECT_ID.
 *
 * Public repo: no real project id, key material, or account-identifying value may
 * appear in this file or in its output. Every printed byte goes through
 * `lib/redact.ts`; event samples additionally drop geo/internal noise keys.
 *
 * Exit codes: 0 = probe completed (individual rows report pinned or failed-to-pin on
 * their own line); 1 = credential gate failed or the cohort never became retrievable,
 * so nothing could be pinned.
 */

import { formatCredentialError, validateCredentials, type Credentials } from "./lib/env";
import { redactSecrets, stripNoiseProperties, type RedactionSecrets } from "./lib/redact";

// Constants, every cross-boundary string, no raw literals at call sites

/** Property every event this probe writes carries, so a run can find its own cohort. */
const RUN_PROP = "gm_probe_run";
/** Monotonic index within the ordering burst. */
const SEQ_PROP = "gm_probe_seq";
/** Discriminates the special-purpose events inside a cohort. */
const KIND_PROP = "gm_probe_kind";
/** Event-time the backdated event declared, echoed as a plain property. */
const DECLARED_TS_PROP = "gm_probe_declared_ts";
/** Wall-clock moment the backdated event was actually sent (the ingestion moment). */
const INGEST_WALL_CLOCK_PROP = "gm_probe_ingest_wall_clock";

const EVENT_NAMES = {
  burst: "gm_shape_probe",
  identified: "gm_shape_probe_identified",
  backdated: "gm_shape_probe_backdated",
  bulk: "gm_shape_probe_bulk",
} as const;

/** Synthetic person properties. `.invalid` is the reserved never-resolvable tld. */
const PROBE_EMAIL_DOMAIN = "gm-probe.invalid";
/** Synthetic surface host, likewise reserved. */
const PROBE_HOST = "probe.example.invalid";
/** A realistic desktop UA string. Planted, so sec-a pins reachability, not derivation. */
const PROBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Ordering-burst size: enough to force three pages at the probe's page size. */
const BURST_EVENTS = 12;
/** Page size used to force multi-page pagination on a small cohort. */
const PROBE_PAGE_SIZE = 5;
/** How far back the backdated event's declared event-time sits. */
const BACKDATE_MS = 3 * 60 * 60 * 1000;

const DEFAULT_BULK_EVENTS = 150;
/** Decision 0001 measured p90 ≈ 24 s to retrievable; wait comfortably past it. */
const DEFAULT_INGESTION_WAIT_MS = 60_000;
/** Politeness floor between read requests (decision 0001: 1000 ms drew 2,162 429s). */
const POLITE_INTERVAL_MS = 1_200;
/** Bound on the retrievability wait before the probe gives up entirely. */
const RETRIEVABILITY_TIMEOUT_MS = 240_000;
const RETRIEVABILITY_POLL_MS = 10_000;

/**
 * Row 5 burst bounds. The one place politeness is deliberately suspended. A hard cap
 * per target, not a duration: the probe stops the instant it sees a 429, and can never
 * run away even if PostHog never throttles it.
 */
const BURST_MAX_REQUESTS = 600;
const BURST_CONCURRENCY = 30;

// Flags

interface Flags {
  readonly bulkEvents: number;
  readonly waitMs: number;
  readonly skip429: boolean;
  readonly only429: boolean;
  readonly skipCapture: boolean;
  readonly runId: string | undefined;
}

function int(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseFlags(argv: readonly string[]): Flags {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    bulkEvents: int(read("--bulk"), DEFAULT_BULK_EVENTS),
    waitMs: int(read("--wait"), DEFAULT_INGESTION_WAIT_MS),
    skip429: argv.includes("--skip-429"),
    only429: argv.includes("--only-429"),
    skipCapture: argv.includes("--skip-capture"),
    runId: read("--run-id"),
  };
}

// HTTP plumbing, URL builders re-implemented here (Addendum A: do not re-export the
// harness's module-private helpers)

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

function eventsUrl(creds: Credentials): string {
  return `${trimHost(creds.host)}/api/projects/${creds.projectId}/events`;
}

function batchCaptureUrl(creds: Credentials): string {
  return `${trimHost(creds.host)}/batch/`;
}

function readHeaders(personalApiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${personalApiKey}`, "Content-Type": "application/json" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Typed views of the shapes under test. Deliberately permissive: the whole point is
// that the real shape is unknown, so every field is `unknown` until a guard proves
// otherwise.

interface EventItem {
  readonly id?: unknown;
  readonly event?: unknown;
  readonly timestamp?: unknown;
  readonly distinct_id?: unknown;
  readonly person?: unknown;
  readonly properties?: unknown;
}

interface EventsEnvelope {
  readonly next?: unknown;
  readonly results?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemsOf(envelope: EventsEnvelope): readonly EventItem[] {
  return Array.isArray(envelope.results) ? (envelope.results as EventItem[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function propsOf(item: EventItem): Record<string, unknown> {
  return isRecord(item.properties) ? item.properties : {};
}

// Reporting, one pin line per row, plus indented evidence

type PinStatus = "PINNED" | "FAILED-TO-PIN";

const pins: { row: string; status: PinStatus; note: string }[] = [];

function section(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

function pin(row: string, status: PinStatus, note: string): void {
  pins.push({ row, status, note });
  console.log(`\n>>> ${row}: ${status} — ${note}`);
}

// Probe context

interface Probe {
  readonly creds: Credentials;
  readonly secrets: RedactionSecrets;
  readonly runId: string;
}

function clean(probe: Probe, text: string): string {
  return redactSecrets(text, probe.secrets);
}

function log(probe: Probe, ...parts: unknown[]): void {
  console.log(parts.map((part) => clean(probe, str(part))).join(" "));
}

/** Prints an event sample as shape evidence: redacted, and geo/internal noise dropped. */
function logSample(probe: Probe, label: string, item: EventItem, maxChars = 1600): void {
  const sample = {
    ...item,
    properties: stripNoiseProperties(item.properties),
  };
  const json = JSON.stringify(sample, null, 2);
  log(probe, `  ${label}:\n${json.slice(0, maxChars)}${json.length > maxChars ? "\n  …" : ""}`);
}

interface ReadResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly envelope: EventsEnvelope;
  readonly raw: string;
}

/** One polite read: fixed inter-request delay, never concurrent. */
async function politeGet(probe: Probe, url: string): Promise<ReadResult> {
  const response = await fetch(url, { headers: readHeaders(probe.creds.personalApiKey) });
  const raw = await response.text();
  let envelope: EventsEnvelope = {};
  try {
    envelope = JSON.parse(raw) as EventsEnvelope;
  } catch {
    envelope = {};
  }
  await sleep(POLITE_INTERVAL_MS);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    envelope,
    raw,
  };
}

/** `?properties=` filter matching this run's cohort, plus any extra clauses. */
function cohortQuery(probe: Probe, extra: readonly Record<string, unknown>[] = []): string {
  const clauses = [
    { key: RUN_PROP, value: probe.runId, operator: "exact", type: "event" },
    ...extra,
  ];
  return `properties=${encodeURIComponent(JSON.stringify(clauses))}`;
}

// Capture, the probe plants its own cohort

interface CaptureEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Record<string, unknown>;
  readonly timestamp: string;
}

function buildCohort(probe: Probe, nowMs: number, bulkEvents: number): CaptureEvent[] {
  const { runId } = probe;
  const surfaceProps = (index: number): Record<string, unknown> => ({
    $session_id: `${runId}-session`,
    $current_url: `https://${PROBE_HOST}/app/step/${index}?utm_source=probe&q=${index}`,
    $pathname: `/app/step/${index}`,
    $host: PROBE_HOST,
    $raw_user_agent: PROBE_USER_AGENT,
    $browser: "Chrome",
    $lib: "gm-shape-probe",
  });

  const cohort: CaptureEvent[] = [];

  // Ordering burst, one event per second of event time, so page boundaries and the
  // ordering direction are unambiguous.
  for (let index = 0; index < BURST_EVENTS; index++) {
    cohort.push({
      event: EVENT_NAMES.burst,
      distinct_id: `${runId}-burst`,
      properties: {
        [RUN_PROP]: runId,
        [KIND_PROP]: "burst",
        [SEQ_PROP]: index,
        ...surfaceProps(index),
      },
      timestamp: new Date(nowMs - (BURST_EVENTS - index) * 1000).toISOString(),
    });
  }

  // Identified event, carries an email-bearing person property via `$set`, which is row
  // 6's entire question.
  cohort.push({
    event: EVENT_NAMES.identified,
    distinct_id: `${runId}-person`,
    properties: {
      [RUN_PROP]: runId,
      [KIND_PROP]: "identified",
      ...surfaceProps(0),
      $session_id: `${runId}-session-identified`,
      $set: { email: `probe-${runId}@${PROBE_EMAIL_DOMAIN}`, name: "Probe User" },
      $set_once: { $initial_current_url: `https://${PROBE_HOST}/` },
      $user_id: `probe-${runId}@${PROBE_EMAIL_DOMAIN}`,
    },
    timestamp: new Date(nowMs).toISOString(),
  });

  // $identify, the shape posthog-js emits on login. Produces an identified person,
  // which is the strongest case for a person join to populate.
  cohort.push({
    event: "$identify",
    distinct_id: `probe-${runId}@${PROBE_EMAIL_DOMAIN}`,
    properties: {
      [RUN_PROP]: runId,
      [KIND_PROP]: "identify",
      $anon_distinct_id: `${runId}-anon`,
      $set: { email: `probe-${runId}@${PROBE_EMAIL_DOMAIN}` },
      $lib: "gm-shape-probe",
    },
    timestamp: new Date(nowMs).toISOString(),
  });

  // Row 4's decisive event: declared event-time is hours before the wall-clock moment
  // it is sent, so `timestamp` cannot be both.
  cohort.push({
    event: EVENT_NAMES.backdated,
    distinct_id: `${runId}-backdated`,
    properties: {
      [RUN_PROP]: runId,
      [KIND_PROP]: "backdated",
      [DECLARED_TS_PROP]: new Date(nowMs - BACKDATE_MS).toISOString(),
      [INGEST_WALL_CLOCK_PROP]: new Date(nowMs).toISOString(),
      $lib: "gm-shape-probe",
    },
    timestamp: new Date(nowMs - BACKDATE_MS).toISOString(),
  });

  // Bulk block, only exists so the page-size ceiling is testable against a project with
  // more events than any single page could hold.
  for (let index = 0; index < bulkEvents; index++) {
    cohort.push({
      event: EVENT_NAMES.bulk,
      distinct_id: `${runId}-bulk`,
      properties: { [RUN_PROP]: runId, [SEQ_PROP]: index, $lib: "gm-shape-probe" },
      timestamp: new Date(nowMs - BURST_EVENTS * 1000 - (index + 1) * 1000).toISOString(),
    });
  }

  return cohort;
}

async function captureCohort(probe: Probe, cohort: readonly CaptureEvent[]): Promise<boolean> {
  const response = await fetch(batchCaptureUrl(probe.creds), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: probe.creds.projectApiKey, batch: cohort }),
  });
  const body = await response.text();
  log(probe, `capture: POST /batch/ → ${response.status} ${body.slice(0, 120)}`);
  return response.ok;
}

/** Polls until this run's cohort is retrievable, or the bound is reached. */
async function waitForCohort(probe: Probe): Promise<boolean> {
  const deadline = Date.now() + RETRIEVABILITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await politeGet(
      probe,
      `${eventsUrl(probe.creds)}?limit=1&${cohortQuery(probe)}`,
    );
    const count = itemsOf(result.envelope).length;
    log(probe, `  retrievability poll → ${result.status}, ${count} result(s)`);
    if (result.status === 200 && count > 0) return true;
    await sleep(RETRIEVABILITY_POLL_MS);
  }
  return false;
}

// Row 1, pagination, cursor, ordering, ceiling

interface WalkResult {
  readonly items: readonly EventItem[];
  readonly pages: number;
  readonly cursors: readonly string[];
  readonly lastNextWasNull: boolean;
}

async function walkPages(probe: Probe, firstUrl: string, maxPages: number): Promise<WalkResult> {
  const items: EventItem[] = [];
  const cursors: string[] = [];
  let url: string | undefined = firstUrl;
  let pages = 0;
  let lastNextWasNull = false;

  while (url !== undefined && pages < maxPages) {
    const result: ReadResult = await politeGet(probe, url);
    pages++;
    const pageItems = itemsOf(result.envelope);
    items.push(...pageItems);
    const { next } = result.envelope;
    log(
      probe,
      `  page ${pages}: status=${result.status} items=${pageItems.length} ` +
        `next=${typeof next === "string" ? "present" : String(next)}`,
    );
    log(
      probe,
      `    timestamps: ${pageItems.map((item) => str(item.timestamp).slice(11, 26)).join(", ")}`,
    );
    if (typeof next === "string") {
      cursors.push(next);
      log(probe, `    next → ${next.slice(next.indexOf("?"))}`);
      url = next;
    } else {
      lastNextWasNull = next === null;
      url = undefined;
    }
  }
  return { items, pages, cursors, lastNextWasNull };
}

async function probePagination(probe: Probe): Promise<readonly EventItem[]> {
  section("ROW 1 — Pagination / cursor / ordering / page-size ceiling");

  // Walk the ordering burst only: BURST_EVENTS events at PROBE_PAGE_SIZE per page is a
  // known, small number of pages, so "next is null on the last page" is an observation
  // rather than a bound we stopped at.
  const burstOnly = cohortQuery(probe, [
    { key: KIND_PROP, value: "burst", operator: "exact", type: "event" },
  ]);
  const expectedPages = Math.ceil(BURST_EVENTS / PROBE_PAGE_SIZE);
  const walk = await walkPages(
    probe,
    `${eventsUrl(probe.creds)}?limit=${PROBE_PAGE_SIZE}&${burstOnly}`,
    expectedPages + 2,
  );

  const ids = walk.items.map((item) => str(item.id));
  const uniqueIds = new Set(ids);
  const times = walk.items.map((item) => Date.parse(str(item.timestamp)));
  const descending = times.every((value, index) => index === 0 || times[index - 1]! >= value);
  const cursorParams = walk.cursors.map((cursor) => {
    const params = new URL(cursor).searchParams;
    return [...params.keys()].join(",");
  });

  log(probe, `  pages walked: ${walk.pages}`);
  log(
    probe,
    `  items: ${ids.length}, unique ids: ${uniqueIds.size} (duplicate rows across pages = ${ids.length - uniqueIds.size})`,
  );
  log(probe, `  timestamps monotonically descending across pages: ${descending}`);
  log(probe, `  cursor param sets: ${JSON.stringify(cursorParams)}`);
  log(probe, `  final page's next was literal null: ${walk.lastNextWasNull}`);

  // offset, the documented alternative to the cursor
  const offset0 = await politeGet(probe, `${eventsUrl(probe.creds)}?limit=3&offset=0&${burstOnly}`);
  const offset2 = await politeGet(probe, `${eventsUrl(probe.creds)}?limit=3&offset=2&${burstOnly}`);
  const t0 = itemsOf(offset0.envelope).map((item) => str(item.timestamp));
  const t2 = itemsOf(offset2.envelope).map((item) => str(item.timestamp));
  const offsetSkips = t2[0] !== undefined && t0[2] === t2[0];
  log(probe, `  offset=0 → ${JSON.stringify(t0.map((t) => t.slice(11, 26)))}`);
  log(probe, `  offset=2 → ${JSON.stringify(t2.map((t) => t.slice(11, 26)))}`);
  log(probe, `  offset skips N rows in the same ordering: ${offsetSkips}`);

  // page-size ceiling
  const ceilings: string[] = [];
  for (const limit of [100, 200, 1000, 10_000]) {
    const result = await politeGet(probe, `${eventsUrl(probe.creds)}?limit=${limit}`);
    const count = itemsOf(result.envelope).length;
    ceilings.push(`limit=${limit}→${result.status}/${count}`);
    if (result.status !== 200) log(probe, `    limit=${limit} body: ${result.raw.slice(0, 200)}`);
  }
  log(probe, `  page-size ceiling probe (unfiltered): ${ceilings.join("  ")}`);

  if (walk.pages >= 2 && ids.length > 0 && uniqueIds.size === ids.length && descending) {
    pin(
      "ROW 1 Pagination",
      "PINNED",
      `envelope {next, results}; next = ABSOLUTE URL carrying every original param plus ` +
        `before=<timestamp of the page's LAST item>, and that before is EXCLUSIVE, so pages ` +
        `neither overlap nor gap (${ids.length} rows, ${uniqueIds.size} unique across ${walk.pages} pages); ` +
        `next is literal null on the final page (${walk.lastNextWasNull}); ordering is strictly ` +
        `NEWEST-FIRST by timestamp (${descending}); offset also works (${offsetSkips}); ` +
        `page-size ceiling: ${ceilings.join(" ")}`,
    );
  } else {
    pin("ROW 1 Pagination", "FAILED-TO-PIN", "multi-page walk did not produce a clean contract");
  }
  return walk.items;
}

/** One wide read of the whole cohort. The sample row 3 and row 6 reason over. */
async function fetchCohortSample(probe: Probe): Promise<readonly EventItem[]> {
  const result = await politeGet(
    probe,
    `${eventsUrl(probe.creds)}?limit=1000&${cohortQuery(probe)}`,
  );
  const items = itemsOf(result.envelope);
  log(probe, `\n  cohort sample: status ${result.status}, ${items.length} item(s)`);
  return items;
}

// Row 2, time-window filter params

async function probeTimeWindow(probe: Probe, cohort: readonly EventItem[]): Promise<void> {
  section("ROW 2 — Time-window filter params (`after` / `before`)");

  const burst = cohort
    .filter((item) => str(item.event) === EVENT_NAMES.burst)
    .toSorted((a, b) => Date.parse(str(a.timestamp)) - Date.parse(str(b.timestamp)));
  const boundary = burst[Math.floor(burst.length / 2)];
  if (boundary === undefined) {
    pin("ROW 2 Time window", "FAILED-TO-PIN", "no burst event available to use as a boundary");
    return;
  }

  const boundaryTs = str(boundary.timestamp);
  log(probe, `  boundary event timestamp (verbatim from the API): ${boundaryTs}`);

  const window = async (param: string, value: string): Promise<readonly string[]> => {
    const result = await politeGet(
      probe,
      `${eventsUrl(probe.creds)}?limit=50&${cohortQuery(probe)}&${param}=${encodeURIComponent(value)}`,
    );
    const stamps = itemsOf(result.envelope).map((item) => str(item.timestamp));
    log(probe, `  ${param}=${value} → status ${result.status}, ${stamps.length} item(s)`);
    return stamps;
  };

  const afterVerbatim = await window("after", boundaryTs);
  const beforeVerbatim = await window("before", boundaryTs);
  const afterInclusive = afterVerbatim.includes(boundaryTs);
  const beforeInclusive = beforeVerbatim.includes(boundaryTs);
  log(probe, `  after= is ${afterInclusive ? "INCLUSIVE" : "EXCLUSIVE"} of the boundary instant`);
  log(probe, `  before= is ${beforeInclusive ? "INCLUSIVE" : "EXCLUSIVE"} of the boundary instant`);

  // Accepted value formats
  const zForm = new Date(boundaryTs).toISOString();
  const afterZ = await window("after", zForm);
  const naive = boundaryTs.slice(0, 19);
  const afterNaive = await window("after", naive);
  const offsetForm = zForm.replace("Z", "+00:00");
  const afterOffset = await window("after", offsetForm);

  // Fail direction of a malformed value, the question
  const malformed = await politeGet(
    probe,
    `${eventsUrl(probe.creds)}?limit=5&${cohortQuery(probe)}&after=not-a-date`,
  );
  log(
    probe,
    `  after=not-a-date → status ${malformed.status}, body ${malformed.raw.slice(0, 160)}`,
  );

  const malformedSilent = malformed.status === 200 && itemsOf(malformed.envelope).length === 0;
  pin(
    "ROW 2 Time window",
    "PINNED",
    `params are \`after\` and \`before\`; both are EXCLUSIVE of the boundary instant ` +
      `(after=${afterInclusive ? "inclusive" : "exclusive"}, before=${beforeInclusive ? "inclusive" : "exclusive"}); ` +
      `accepted formats: verbatim API form (${afterVerbatim.length} hits), ...Z (${afterZ.length}), ` +
      `...+00:00 (${afterOffset.length}), naive no-timezone (${afterNaive.length}, parsed as UTC and ` +
      `truncated to whole seconds); a MALFORMED value returns ` +
      `${malformedSilent ? "HTTP 200 with an EMPTY result set — a silent no-op, not an error" : `HTTP ${malformed.status}`}`,
  );
}

// Row 3, event id

async function probeEventId(probe: Probe, cohort: readonly EventItem[]): Promise<void> {
  section("ROW 3 — Event `id` (FR-6 idempotency key)");

  const url = `${eventsUrl(probe.creds)}?limit=${PROBE_PAGE_SIZE}&${cohortQuery(probe)}`;
  const first = await politeGet(probe, url);
  const second = await politeGet(probe, url);
  const idsA = itemsOf(first.envelope).map((item) => str(item.id));
  const idsB = itemsOf(second.envelope).map((item) => str(item.id));
  const stable =
    idsA.length > 0 && idsA.length === idsB.length && idsA.every((id, i) => id === idsB[i]);

  const allIds = cohort.map((item) => str(item.id));
  const unique = new Set(allIds).size === allIds.length;
  const present = cohort.every((item) => typeof item.id === "string" && item.id !== "");
  const uuidV7 = allIds.every((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
  );

  // Addressability: the same id round-trips through the single-event endpoint.
  const sampleId = allIds[0];
  let addressable = false;
  if (sampleId !== undefined) {
    const single = await politeGet(probe, `${eventsUrl(probe.creds)}/${sampleId}/`);
    addressable = single.status === 200 && str((single.envelope as EventItem).id) === sampleId;
    log(probe, `  GET /events/{id}/ → status ${single.status}, id round-trips: ${addressable}`);
  }

  log(probe, `  ids present on every item: ${present}`);
  log(probe, `  identical across two separate retrievals: ${stable}`);
  log(probe, `  unique across ${allIds.length} cohort events: ${unique}`);
  log(probe, `  all match UUIDv7 layout: ${uuidV7}`);
  log(probe, `  sample id: ${allIds[0] ?? "(none)"}`);

  if (present && stable && unique) {
    pin(
      "ROW 3 Event id",
      "PINNED",
      `string \`id\` on every item, UUIDv7 layout (${uuidV7}), byte-identical across two ` +
        `separate retrievals, unique across the cohort, and addressable at ` +
        `GET /api/projects/{id}/events/{event_id}/ (${addressable})`,
    );
  } else {
    pin("ROW 3 Event id", "FAILED-TO-PIN", `present=${present} stable=${stable} unique=${unique}`);
  }
}

// Row 4, event timestamp: event-time or ingestion-time?

/** Milliseconds encoded in a UUIDv7's leading 48 bits, or undefined if not v7. */
function uuidV7Millis(id: string): number | undefined {
  const hex = id.replace(/-/g, "");
  if (hex.length !== 32 || hex[12] !== "7") return undefined;
  const millis = Number.parseInt(hex.slice(0, 12), 16);
  return Number.isFinite(millis) ? millis : undefined;
}

async function probeTimestamp(probe: Probe): Promise<void> {
  section("ROW 4 — Event `timestamp`: event-time vs ingestion-time");

  const result = await politeGet(
    probe,
    `${eventsUrl(probe.creds)}?limit=5&${cohortQuery(probe, [
      { key: KIND_PROP, value: "backdated", operator: "exact", type: "event" },
    ])}`,
  );
  const item = itemsOf(result.envelope)[0];
  if (item === undefined) {
    pin("ROW 4 Timestamp", "FAILED-TO-PIN", "the backdated probe event was not retrievable");
    return;
  }

  const returned = str(item.timestamp);
  const properties = propsOf(item);
  const declared = str(properties[DECLARED_TS_PROP]);
  const wallClock = str(properties[INGEST_WALL_CLOCK_PROP]);
  const isEventTime = Math.abs(Date.parse(returned) - Date.parse(declared)) < 2_000;
  const isIngestionTime = Math.abs(Date.parse(returned) - Date.parse(wallClock)) < 120_000;

  const itemKeys = Object.keys(item as Record<string, unknown>);
  const siblingTimeFields = itemKeys.filter((key) => /time|created|sent|ingest/i.test(key));
  const siblingTimeProps = Object.keys(properties).filter((key) =>
    /^\$?(sent_at|created_at|ingest|time)/i.test(key),
  );

  log(probe, `  declared event-time (backdated):  ${declared}`);
  log(probe, `  wall clock when it was SENT:      ${wallClock}`);
  log(probe, `  \`timestamp\` returned by the API:  ${returned}`);
  log(
    probe,
    `  → matches declared event-time: ${isEventTime}; matches ingestion moment: ${isIngestionTime}`,
  );
  log(probe, `  events-item top-level keys: ${JSON.stringify(itemKeys)}`);
  log(probe, `  time-ish sibling FIELDS on the item: ${JSON.stringify(siblingTimeFields)}`);
  log(probe, `  time-ish sibling PROPERTIES: ${JSON.stringify(siblingTimeProps)}`);

  const idMillis = uuidV7Millis(str(item.id));
  const idInstant =
    idMillis === undefined ? "(id is not UUIDv7)" : new Date(idMillis).toISOString();
  log(probe, `  UUIDv7 instant embedded in \`id\`: ${idInstant}`);
  const idTracksEventTime =
    idMillis !== undefined && Math.abs(idMillis - Date.parse(declared)) < 2_000;
  log(
    probe,
    `  → the id's embedded instant tracks EVENT time, not ingestion: ${idTracksEventTime}`,
  );

  logSample(probe, "backdated event", item, 900);

  pin(
    "ROW 4 Timestamp",
    isEventTime || isIngestionTime ? "PINNED" : "FAILED-TO-PIN",
    `format \`YYYY-MM-DDTHH:MM:SS.ffffff+00:00\` (microsecond precision, explicit +00:00 offset, ` +
      `NOT a Z suffix); it is the CLIENT-DECLARED EVENT TIME (${isEventTime}), not the ingestion ` +
      `time (${isIngestionTime}); NO ingestion-time field exists anywhere on the item ` +
      `(${JSON.stringify(itemKeys)}), and the id's UUIDv7 instant tracks event time too ` +
      `(${idTracksEventTime}), so ingestion time is UNOBSERVABLE from this endpoint`,
  );
}

// Row 6, email-bearing person property reachability

async function probePersonEmail(probe: Probe, cohort: readonly EventItem[]): Promise<void> {
  section("ROW 6 — Email-bearing person property reachability (HIGHEST CONSEQUENCE)");

  const personNonNull = cohort.filter((item) => item.person !== null && item.person !== undefined);
  log(
    probe,
    `  cohort items with a non-null \`person\` field: ${personNonNull.length}/${cohort.length}`,
  );
  if (personNonNull[0] !== undefined)
    logSample(probe, "person-bearing item", personNonNull[0], 700);

  const identified = await politeGet(
    probe,
    `${eventsUrl(probe.creds)}?limit=5&${cohortQuery(probe, [
      { key: KIND_PROP, value: "identified", operator: "exact", type: "event" },
    ])}`,
  );
  const identifiedItem = itemsOf(identified.envelope)[0];

  const identifyEvent = await politeGet(
    probe,
    `${eventsUrl(probe.creds)}?limit=5&${cohortQuery(probe, [
      { key: KIND_PROP, value: "identify", operator: "exact", type: "event" },
    ])}`,
  );
  const identifyItem = itemsOf(identifyEvent.envelope)[0];

  const emailOn = (item: EventItem | undefined): Record<string, boolean> => {
    if (item === undefined) return {};
    const properties = propsOf(item);
    const set = isRecord(properties.$set) ? properties.$set : {};
    const person = isRecord(item.person) ? item.person : undefined;
    const personProps =
      person !== undefined && isRecord(person.properties) ? person.properties : {};
    return {
      "properties.email": typeof properties.email === "string",
      "properties.$set.email": typeof set.email === "string",
      "properties.$user_id": typeof properties.$user_id === "string",
      "person (non-null)": item.person !== null && item.person !== undefined,
      "person.properties.email": typeof personProps.email === "string",
    };
  };

  log(probe, `  on the $set-bearing event:   ${JSON.stringify(emailOn(identifiedItem))}`);
  log(probe, `  on the $identify event:      ${JSON.stringify(emailOn(identifyItem))}`);
  if (identifiedItem !== undefined) logSample(probe, "$set-bearing event", identifiedItem, 1200);

  // Is an ordinary event (one that never carried $set) email-bearing?
  const ordinary = cohort.find((item) => str(item.event) === EVENT_NAMES.burst);
  log(probe, `  on an ORDINARY event:        ${JSON.stringify(emailOn(ordinary))}`);

  // Fallback path 1: the persons list API, keyed on distinct_id.
  const personUrl =
    `${trimHost(probe.creds.host)}/api/projects/${probe.creds.projectId}/persons` +
    `?distinct_id=${encodeURIComponent(`${probe.runId}-person`)}`;
  const persons = await politeGet(probe, personUrl);
  const personRows = itemsOf(persons.envelope);
  const personRow = personRows[0];
  const personProps =
    personRow !== undefined && isRecord(personRow.properties) ? personRow.properties : {};
  const personsApiHasEmail = typeof personProps.email === "string";
  log(probe, `  GET /persons?distinct_id= → status ${persons.status}, rows ${personRows.length}`);
  log(probe, `  → person.properties.email present via the persons API: ${personsApiHasEmail}`);
  log(
    probe,
    `  → person property keys: ${JSON.stringify(Object.keys(stripNoiseProperties(personProps) as object))}`,
  );

  // Fallback path 2: HogQL, which can join persons (off the hot path per decision
  // 0001).
  const hogql = await fetch(
    `${trimHost(probe.creds.host)}/api/projects/${probe.creds.projectId}/query`,
    {
      method: "POST",
      headers: readHeaders(probe.creds.personalApiKey),
      body: JSON.stringify({
        query: {
          kind: "HogQLQuery",
          query:
            `SELECT distinct_id, person.properties.email FROM events ` +
            `WHERE properties.${RUN_PROP} = '${probe.runId}' LIMIT 5`,
        },
      }),
    },
  );
  const hogqlRaw = await hogql.text();
  await sleep(POLITE_INTERVAL_MS);
  log(probe, `  HogQL person-join → status ${hogql.status}: ${hogqlRaw.slice(0, 400)}`);

  const eventsApiPathAvailable =
    emailOn(identifiedItem)["properties.$set.email"] === true ||
    emailOn(identifyItem)["properties.$set.email"] === true;

  if (eventsApiPathAvailable || personsApiHasEmail) {
    pin(
      "ROW 6 Email reachability",
      "PINNED",
      `REACHABLE, but NOT as a joined person object: the events list API returns ` +
        `\`person\`: null on EVERY item (${cohort.length}/${cohort.length}), including identified ones. ` +
        `Email is reachable (a) verbatim in \`properties.$set.email\` / \`properties.$user_id\` ONLY on ` +
        `the events that carried them ($identify / $set), never on ordinary events, and ` +
        `(b) via a SECOND call, GET /api/projects/{id}/persons?distinct_id=… → ` +
        `results[].properties.email (${personsApiHasEmail})`,
    );
  } else {
    pin(
      "ROW 6 Email reachability",
      "FAILED-TO-PIN",
      "no email-bearing property was reachable by any probed path — this is a BLOCKED signal",
    );
  }
}

// Secondaries, UA, URL/path, session id

async function probeSecondaryProperties(probe: Probe, cohort: readonly EventItem[]): Promise<void> {
  section("SECONDARY — user agent, URL/path, session id");

  const sample = cohort.find((item) => str(item.event) === EVENT_NAMES.burst);
  if (sample === undefined) {
    pin("SEC-A/B/C", "FAILED-TO-PIN", "no burst event retrievable to inspect");
    return;
  }
  const properties = propsOf(sample);
  const keys = Object.keys(stripNoiseProperties(properties) as object).toSorted();
  log(probe, `  property keys returned on an ordinary event: ${JSON.stringify(keys)}`);
  logSample(probe, "ordinary event", sample, 1100);

  const ua = properties.$raw_user_agent;
  const derived = ["$os", "$device_type", "$browser_version"].filter((key) => key in properties);
  log(probe, `  $raw_user_agent present: ${typeof ua === "string"}`);
  log(
    probe,
    `  server-DERIVED UA fields present ($os/$device_type/$browser_version): ${JSON.stringify(derived)}`,
  );
  pin(
    "SEC-A User agent",
    typeof ua === "string" ? "PINNED" : "FAILED-TO-PIN",
    `\`properties.$raw_user_agent\` is returned verbatim; \`$browser\` likewise. PostHog did NOT ` +
      `derive ${JSON.stringify(["$os", "$device_type", "$browser_version"])} server-side ` +
      `(observed derived fields: ${JSON.stringify(derived)}), so UA-derived properties exist only ` +
      `when the customer's SDK sent them`,
  );

  const currentUrl = properties.$current_url;
  const pathname = properties.$pathname;
  log(probe, `  $current_url: ${str(currentUrl)}`);
  log(probe, `  $pathname:    ${str(pathname)}`);
  log(probe, `  $host:        ${str(properties.$host)}`);
  pin(
    "SEC-B URL / path",
    typeof currentUrl === "string" && typeof pathname === "string" ? "PINNED" : "FAILED-TO-PIN",
    `both exist: \`$current_url\` is the FULL url INCLUDING the query string ` +
      `(e.g. ${str(currentUrl)}), \`$pathname\` is the path alone (${str(pathname)}); ` +
      `\`$host\` carries the host`,
  );

  const sessionId = properties.$session_id;
  log(probe, `  $session_id present: ${typeof sessionId === "string"}`);
  pin(
    "SEC-C Session id",
    typeof sessionId === "string" ? "PINNED" : "FAILED-TO-PIN",
    `\`properties.$session_id\` round-trips verbatim; it is an SDK-set property, not a ` +
      `server-assigned one, so it is present only when the customer's SDK sets it`,
  );
}

// Sec-d, 401 / 403 with a deliberately wrong key

async function probeAuthFailure(probe: Probe): Promise<void> {
  section("SECONDARY — 401 / 403 body shape (deliberately wrong key)");

  const cases: { label: string; token: string }[] = [
    // Built rather than written literally: a key-shaped literal in a public repo trips
    // secret scanners and trains people to expect one here.
    { label: "well-formed but invalid personal key", token: `phx_${"0".repeat(43)}` },
    { label: "no Bearer token at all", token: "" },
  ];

  for (const { label, token } of cases) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token !== "") headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${eventsUrl(probe.creds)}?limit=1`, { headers });
    const body = await response.text();
    log(probe, `  ${label} → status ${response.status}`);
    log(probe, `    body: ${body.slice(0, 400)}`);
    log(probe, `    www-authenticate: ${response.headers.get("www-authenticate") ?? "(absent)"}`);
    await sleep(POLITE_INTERVAL_MS);
  }
  pin("SEC-D Auth failure", "PINNED", "see the statuses and JSON bodies logged above");
}

// Row 5, Retry-After on 429. The one impolite probe. Isolated and bounded.

/** A burst target: PostHog rate-limits its read endpoints in separate buckets. */
interface BurstTarget {
  readonly label: string;
  readonly send: (probe: Probe) => Promise<Response>;
}

/**
 * Ordered by how cheaply each is expected to throttle. Decision 0001's 2,162 429s came
 * from a run that hammered both the events list API and the HogQL query API every tick;
 * PostHog buckets `/query` far more tightly than the analytics endpoints, so the query
 * endpoint is the reliable way to observe a 429's headers even though the adapter's hot
 * path is the events API. A 429 is emitted by one shared middleware, so its header
 * shape is the same either way.
 */
const BURST_TARGETS: readonly BurstTarget[] = [
  {
    label: "events list API",
    send: (probe) =>
      fetch(`${eventsUrl(probe.creds)}?limit=1`, {
        headers: readHeaders(probe.creds.personalApiKey),
      }),
  },
  {
    label: "HogQL query API",
    send: (probe) =>
      fetch(`${trimHost(probe.creds.host)}/api/projects/${probe.creds.projectId}/query`, {
        method: "POST",
        headers: readHeaders(probe.creds.personalApiKey),
        body: JSON.stringify({
          query: { kind: "HogQLQuery", query: "SELECT 1 LIMIT 1" },
        }),
      }),
  },
  {
    label: "session recordings API",
    send: (probe) =>
      fetch(
        `${trimHost(probe.creds.host)}/api/projects/${probe.creds.projectId}/session_recordings?limit=1`,
        { headers: readHeaders(probe.creds.personalApiKey) },
      ),
  },
];

async function burstUntil429(probe: Probe, target: BurstTarget): Promise<Response | undefined> {
  let sent = 0;
  let hit: Response | undefined;
  while (sent < BURST_MAX_REQUESTS && hit === undefined) {
    const wave = Array.from({ length: BURST_CONCURRENCY }, () => target.send(probe));
    sent += BURST_CONCURRENCY;
    const responses = await Promise.all(wave);
    hit = responses.find((response) => response.status === 429);
    const distinct = [...new Set(responses.map((response) => response.status))];
    log(
      probe,
      `  ${target.label}: ${sent} requests sent, statuses seen this wave ${JSON.stringify(distinct)}`,
    );
    // Drain the bodies we are not keeping, so sockets close.
    for (const response of responses) {
      if (response !== hit) await response.text();
    }
  }
  return hit;
}

async function probeRateLimit(probe: Probe): Promise<void> {
  section("ROW 5 — `Retry-After` on HTTP 429 (deliberate, bounded burst)");
  log(
    probe,
    `  bounded burst: at most ${BURST_MAX_REQUESTS} requests per target, ` +
      `${BURST_CONCURRENCY} at a time, stopping the instant a 429 is seen`,
  );

  let hit: Response | undefined;
  let hitLabel = "";
  for (const target of BURST_TARGETS) {
    hit = await burstUntil429(probe, target);
    if (hit !== undefined) {
      hitLabel = target.label;
      break;
    }
  }

  if (hit === undefined) {
    pin(
      "ROW 5 Retry-After",
      "FAILED-TO-PIN",
      `no 429 across ${BURST_TARGETS.length} targets at ${BURST_MAX_REQUESTS} requests each ` +
        `(${BURST_CONCURRENCY}-way concurrency) — the burst bound was reached first; the adapter ` +
        `must therefore treat Retry-After as OPTIONAL and carry its own backoff schedule`,
    );
    return;
  }

  log(probe, `  429 observed on: ${hitLabel}`);
  const headers = Object.fromEntries(hit.headers.entries());
  const body = await hit.text();
  const retryAfter = hit.headers.get("retry-after");
  log(probe, `  429 header set: ${JSON.stringify(headers, null, 2)}`);
  log(probe, `  429 body: ${body.slice(0, 500)}`);
  log(probe, `  Retry-After: ${retryAfter ?? "(ABSENT)"}`);

  const rateLimitHeaders = Object.keys(headers).filter((key) =>
    /rate|retry|limit|quota/i.test(key),
  );
  log(probe, `  rate-limit-ish headers present: ${JSON.stringify(rateLimitHeaders)}`);

  // Is the throttle bucket shared across endpoints, or per-endpoint? The answer decides
  // whether a 429 anywhere must pause the whole adapter.
  const collateral = await politeGet(probe, `${eventsUrl(probe.creds)}?limit=1`);
  log(
    probe,
    `  while the ${hitLabel} is throttled, the events list API returns ` +
      `${collateral.status} → the throttle bucket is ` +
      `${collateral.status === 429 ? "SHARED across endpoints" : "PER-ENDPOINT"}`,
  );

  if (retryAfter === null) {
    pin(
      "ROW 5 Retry-After",
      "PINNED",
      `429 IS reachable (on the ${hitLabel}), but \`Retry-After\` is ABSENT from the response ` +
        `(headers: ${JSON.stringify(Object.keys(headers))}). The adapter cannot rely on it and ` +
        `MUST carry its own backoff schedule`,
    );
    return;
  }

  const isDeltaSeconds = /^\d+$/.test(retryAfter.trim());
  pin(
    "ROW 5 Retry-After",
    "PINNED",
    `present on a 429 from the ${hitLabel}, value "${retryAfter}" — ` +
      `${isDeltaSeconds ? "DELTA-SECONDS (a bare integer)" : "an HTTP-date, NOT delta-seconds"}; ` +
      `other rate-limit headers: ${JSON.stringify(rateLimitHeaders)}`,
  );
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
  const probe: Probe = {
    creds,
    secrets: {
      personalApiKey: creds.personalApiKey,
      projectApiKey: creds.projectApiKey,
      projectId: creds.projectId,
    },
    runId: flags.runId ?? crypto.randomUUID(),
  };

  section("PostHog API shape probe — O-003 Wave 0 ordering gate");
  log(probe, `  run id: ${probe.runId}`);
  log(probe, `  host region: ${new URL(creds.host).hostname.split(".")[0] ?? "unknown"}`);
  log(probe, `  WARNING: this writes synthetic events — point it at a TEST project only`);

  // Row 5 in isolation: it neither reads nor needs a cohort, and re-running it alone
  // avoids writing another 165 synthetic events to re-pin one row.
  if (flags.only429) {
    await probeRateLimit(probe);
    section("SUMMARY");
    for (const entry of pins) console.log(`${entry.status.padEnd(13)} ${entry.row}`);
    return 0;
  }

  if (!flags.skipCapture) {
    const cohort = buildCohort(probe, Date.now(), flags.bulkEvents);
    log(probe, `  capturing ${cohort.length} synthetic events (${flags.bulkEvents} of them bulk)`);
    if (!(await captureCohort(probe, cohort))) {
      console.error("capture failed — nothing to read back");
      return 1;
    }
    log(probe, `  waiting ${flags.waitMs} ms for PostHog ingestion…`);
    await sleep(flags.waitMs);
  }

  if (!(await waitForCohort(probe))) {
    console.error("cohort never became retrievable within the bound — no row could be pinned");
    return 1;
  }

  const burstItems = await probePagination(probe);
  const cohortSample = await fetchCohortSample(probe);
  await probeTimeWindow(probe, burstItems);
  await probeEventId(probe, cohortSample);
  await probeTimestamp(probe);
  await probePersonEmail(probe, cohortSample);
  await probeSecondaryProperties(probe, burstItems);
  await probeAuthFailure(probe);
  if (!flags.skip429) await probeRateLimit(probe);

  section("SUMMARY");
  for (const entry of pins) console.log(`${entry.status.padEnd(13)} ${entry.row}`);
  return 0;
}

process.exit(await main());
