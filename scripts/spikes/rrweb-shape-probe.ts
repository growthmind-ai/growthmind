#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RRWEB_HOST_ENV = "RRWEB_HOST";
const RRWEB_KEY_ENV = "RRWEB_READ_API_KEY";
const DEFAULT_HOST = "https://api.rrweb.com";
const MINT_KEY_URL = "app.rrweb.com/api-keys";

const POLITE_INTERVAL_MS = 1_200;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUESTS = 8;
const RECORDING_LIST_LIMIT = 25;

const CANDIDATE_BASE_PATHS = ["/recordings", "/rr/recordings"] as const;
const RECORDING_ENVELOPE_KEYS = ["recordings", "results", "data", "items"] as const;
const EVENT_ENVELOPE_KEYS = ["events", "results", "data"] as const;
const RECORDING_ID_KEYS = ["id", "recordingId", "recording_id"] as const;
const CURSOR_KEYS = ["next", "nextCursor", "next_cursor"] as const;
const TIMESTAMP_KEY_PATTERN = /created|started|updated|ended|activity|timestamp|_at$/i;

interface RunState {
  readonly host: string;
  readonly key: string;
  requestsUsed: number;
}

interface HttpResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly raw: string;
}

type PinStatus = "PINNED" | "FAILED-TO-PIN";
interface PinEntry {
  readonly row: string;
  readonly status: PinStatus;
  readonly note: string;
}

const pins: PinEntry[] = [];

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function section(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

function redact(text: string, key: string): string {
  return key === "" ? text : text.replaceAll(key, "[redacted]");
}

function log(state: RunState, ...parts: unknown[]): void {
  console.log(parts.map((part) => redact(String(part), state.key)).join(" "));
}

function pin(row: string, status: PinStatus, note: string): void {
  pins.push({ row, status, note });
  console.log(`\n>>> ${row}: ${status} — ${note}`);
}

function missingKeyMessage(): string {
  return (
    `${RRWEB_KEY_ENV} is not set, so this probe did not run — mint a read-scoped key ` +
    `(the read:recordingMetadata scope) at ${MINT_KEY_URL} and set ${RRWEB_KEY_ENV} before running it again.`
  );
}

async function politeRequest(state: RunState, url: string, authKey: string): Promise<HttpResult> {
  if (state.requestsUsed >= MAX_REQUESTS) {
    return { status: -1, headers: {}, body: null, raw: "request budget exhausted" };
  }
  state.requestsUsed += 1;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${authKey}`, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    await sleep(POLITE_INTERVAL_MS);
    return {
      status: 0,
      headers: {},
      body: null,
      raw: error instanceof Error ? error.message : String(error),
    };
  }

  const raw = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  await sleep(POLITE_INTERVAL_MS);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    raw,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

interface Envelope {
  readonly shape: string;
  readonly items: readonly unknown[];
}

function envelopeOf(body: unknown, keys: readonly string[]): Envelope {
  if (Array.isArray(body)) {
    return { shape: "bare array", items: body };
  }
  if (isRecord(body)) {
    const matched = keys.find((key) => Array.isArray(body[key]));
    if (matched !== undefined) {
      return { shape: `{ ${matched}: [...] }`, items: body[matched] as unknown[] };
    }
    return { shape: `unrecognized object (keys: ${JSON.stringify(Object.keys(body))})`, items: [] };
  }
  return { shape: "unrecognized (not an array or object)", items: [] };
}

interface BasePathResult {
  readonly basePath: string;
  readonly listResponse: HttpResult;
}

async function probeBasePath(state: RunState): Promise<BasePathResult | undefined> {
  section("ROW 1 — Base path: /recordings vs /rr/recordings");

  const attempts: { basePath: string; result: HttpResult }[] = [];
  for (const basePath of CANDIDATE_BASE_PATHS) {
    const url = `${state.host}${basePath}?limit=${RECORDING_LIST_LIMIT}`;
    const result = await politeRequest(state, url, state.key);
    log(state, `  GET ${basePath}?limit=${RECORDING_LIST_LIMIT} -> status ${result.status}`);
    if (result.status !== 200) {
      log(state, `    body: ${redact(result.raw, state.key).slice(0, 300)}`);
    }
    attempts.push({ basePath, result });
    if (result.status === 200) break;
  }

  const hit = attempts.find((attempt) => attempt.result.status === 200);
  if (hit !== undefined) {
    const untried = CANDIDATE_BASE_PATHS.filter((path) => path !== hit.basePath);
    const untriedNote = attempts.length === 1 ? ` (untried: ${untried.join(", ")})` : "";
    pin("ROW 1 Base path", "PINNED", `\`${hit.basePath}\` answers 200 with this key${untriedNote}`);
    return { basePath: hit.basePath, listResponse: hit.result };
  }

  const summary = attempts
    .map((attempt) => `${attempt.basePath}=${attempt.result.status}`)
    .join(", ");
  pin(
    "ROW 1 Base path",
    "FAILED-TO-PIN",
    `neither candidate answered 200 (${summary}); a 404 on a candidate suggests it is not served at all, ` +
      "while 401/403 suggests the path exists but this key lacks access to it",
  );
  return undefined;
}

interface RecordingsEnvelopeResult {
  readonly items: readonly unknown[];
  readonly idKey?: string;
  readonly sampleRecordingId?: string;
}

async function probeRecordingsEnvelope(
  state: RunState,
  listResponse: HttpResult,
): Promise<RecordingsEnvelopeResult> {
  section("ROW 2 — Recordings list envelope, id key, timestamp keys");

  const { shape, items } = envelopeOf(listResponse.body, RECORDING_ENVELOPE_KEYS);
  const firstRecord = isRecord(items[0]) ? items[0] : undefined;
  const idKey =
    firstRecord === undefined
      ? undefined
      : RECORDING_ID_KEYS.find((key) => stringValue(firstRecord, key) !== undefined);
  const timestampKeys =
    firstRecord === undefined
      ? []
      : Object.keys(firstRecord).filter((key) => TIMESTAMP_KEY_PATTERN.test(key));

  log(state, `  envelope shape: ${shape}`);
  log(state, `  item count: ${items.length}`);
  if (firstRecord !== undefined) {
    log(state, `  first item keys: ${JSON.stringify(Object.keys(firstRecord))}`);
  }
  log(state, `  id key: ${idKey ?? "(none of id|recordingId|recording_id matched)"}`);
  log(state, `  timestamp-ish keys observed on the first item: ${JSON.stringify(timestampKeys)}`);

  const sampleRecordingId =
    idKey === undefined || firstRecord === undefined ? undefined : stringValue(firstRecord, idKey);

  if (idKey !== undefined && sampleRecordingId !== undefined) {
    pin(
      "ROW 2 Recordings envelope",
      "PINNED",
      `envelope is ${shape} (${items.length} item(s)); id key is \`${idKey}\`; ` +
        `timestamp-ish keys: ${JSON.stringify(timestampKeys)}`,
    );
    return { items, idKey, sampleRecordingId };
  }

  pin(
    "ROW 2 Recordings envelope",
    "FAILED-TO-PIN",
    `envelope is ${shape} but no item carried id|recordingId|recording_id, or the list was empty (${items.length} item(s))`,
  );
  return { items };
}

function cursorKeyAndValue(body: unknown): { key: string; value: string } | undefined {
  if (!isRecord(body)) return undefined;
  for (const key of CURSOR_KEYS) {
    const value = body[key];
    if (typeof value === "string" && value !== "") return { key, value };
  }
  return undefined;
}

async function probeCursor(state: RunState, listResponse: HttpResult): Promise<void> {
  section("ROW 3 — Pagination cursor key and shape");

  const found = cursorKeyAndValue(listResponse.body);
  if (found === undefined) {
    pin(
      "ROW 3 Cursor",
      "FAILED-TO-PIN",
      `no key among ${CURSOR_KEYS.join("|")} carried a non-empty string on the recordings response`,
    );
    return;
  }

  const { key, value } = found;
  const isAbsolute = /^https?:\/\//i.test(value);
  log(state, `  cursor key: ${key}`);
  log(state, `  cursor form: ${isAbsolute ? "absolute URL" : "opaque token"}`);

  if (!isAbsolute) {
    // parse.ts's cursorOf treats every cursor as an absolute same-origin URL; an opaque
    // token would be flagged malformed there and pagination would stop after one page.
    pin(
      "ROW 3 Cursor",
      "PINNED",
      `cursor key \`${key}\` is an OPAQUE token, not a URL — parse.ts's cursorOf would currently ` +
        "drop it as malformed (isSameOriginAsHost expects an absolute URL), stopping pagination after one page",
    );
    return;
  }

  const followed = await politeRequest(state, value, state.key);
  log(state, `  following the cursor URL -> status ${followed.status}`);
  pin(
    "ROW 3 Cursor",
    followed.status === 200 ? "PINNED" : "FAILED-TO-PIN",
    `cursor key \`${key}\` is an ABSOLUTE URL; following it returned ${followed.status}` +
      (followed.status === 200
        ? " — the walk works end to end"
        : " — shape known, walk unconfirmed"),
  );
}

async function probeEventsEnvelope(
  state: RunState,
  basePath: string | undefined,
  recordingId: string | undefined,
): Promise<void> {
  section("ROW 4 — Recording events envelope");

  if (basePath === undefined || recordingId === undefined) {
    pin(
      "ROW 4 Events envelope",
      "FAILED-TO-PIN",
      "no confirmed base path and recording id from ROW 1/ROW 2 to probe events against",
    );
    return;
  }

  const url = `${state.host}${basePath}/${encodeURIComponent(recordingId)}/events?limit=${RECORDING_LIST_LIMIT}`;
  const result = await politeRequest(state, url, state.key);
  log(state, `  GET .../{recordingId}/events -> status ${result.status}`);
  if (result.status !== 200) {
    log(state, `    body: ${redact(result.raw, state.key).slice(0, 300)}`);
    pin(
      "ROW 4 Events envelope",
      "FAILED-TO-PIN",
      `events endpoint returned ${result.status}, not 200`,
    );
    return;
  }

  const { shape, items } = envelopeOf(result.body, EVENT_ENVELOPE_KEYS);
  const first = items[0];
  const bareRrweb =
    isRecord(first) &&
    typeof first.type === "number" &&
    typeof first.timestamp === "number" &&
    "data" in first;

  log(state, `  envelope shape: ${shape}`);
  log(state, `  item count: ${items.length}`);
  if (first !== undefined) {
    log(state, `  first item: ${redact(JSON.stringify(first), state.key).slice(0, 500)}`);
  }
  log(state, `  items are bare rrweb {type,timestamp,data} objects: ${bareRrweb}`);

  pin(
    "ROW 4 Events envelope",
    items.length > 0 ? "PINNED" : "FAILED-TO-PIN",
    `envelope is ${shape} (${items.length} item(s)); items ${bareRrweb ? "ARE" : "are NOT"} bare rrweb {type,timestamp,data} objects`,
  );
}

async function probeErrorShapes(
  state: RunState,
  basePath: string | undefined,
  recordingId: string | undefined,
): Promise<void> {
  section("ROW 5 — 401 / 403 / 404 / 429 body shapes");

  const probedPath = basePath ?? CANDIDATE_BASE_PATHS[0];
  const bogusKey = "gm-probe-deliberately-invalid-key";
  const authResult = await politeRequest(state, `${state.host}${probedPath}?limit=1`, bogusKey);
  log(state, `  deliberately wrong key -> status ${authResult.status}`);
  log(state, `    body: ${redact(authResult.raw, state.key).slice(0, 300)}`);

  let notFoundStatus: number | undefined;
  if (recordingId !== undefined) {
    const bogusId = `gm-probe-nonexistent-${crypto.randomUUID()}`;
    const notFoundResult = await politeRequest(
      state,
      `${state.host}${probedPath}/${encodeURIComponent(bogusId)}/events?limit=1`,
      state.key,
    );
    notFoundStatus = notFoundResult.status;
    log(state, `  bogus recording id -> status ${notFoundResult.status}`);
    log(state, `    body: ${redact(notFoundResult.raw, state.key).slice(0, 300)}`);
  }

  const sawAuthFailure = authResult.status === 401 || authResult.status === 403;
  pin(
    "ROW 5 Error shapes",
    sawAuthFailure ? "PINNED" : "FAILED-TO-PIN",
    `wrong-key request -> ${authResult.status} (body logged above); bogus-recording-id request -> ` +
      `${notFoundStatus ?? "not attempted (no recording id)"}. 403 and 429 are not deliberately triggered — ` +
      "this probe never bursts — so they are pinned only if one appeared incidentally above",
  );
}

function buildNotesMarkdown(state: RunState): string {
  const lines: string[] = [
    "# Spike — rrweb.com read API shape probe",
    "",
    `**Run:** ${new Date().toISOString().slice(0, 10)}, against \`${state.host}\` with a live read-scoped key. ` +
      "Read-only; no writes were made.",
    "",
    "**Question it settles:** the recordings envelope, id key, cursor shape, and events envelope in " +
      "`packages/adapters/src/rrweb/parse.ts` were written tolerant because a live probe on 2026-08-04 " +
      "(before a read-scoped key existed) returned 401 `missing scope read:recordingMetadata` on every " +
      "read endpoint. This file is that probe's real output.",
    "",
    "## Result",
    "",
    // A list, not a table: prettier realigns table pipes, so a generated table fails
    // `format:check` the moment this file is written.
    ...pins.flatMap((entry) => [`- **${entry.row} — ${entry.status}.** ${entry.note}`, ""]),
    "A row can only pin what the account holds. Rows 2 to 4 read a recording's own shape,",
    "so they stay unpinned until capture has sent at least one recording; re-run the probe",
    "once it has.",
    "",
  ];
  return lines.join("\n");
}

async function writeNotes(state: RunState): Promise<void> {
  const path = join(import.meta.dir, "notes", "rrweb-read-api.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buildNotesMarkdown(state), "utf8");
  console.log(`\nfindings written to ${path}`);
}

async function main(): Promise<number> {
  const key = process.env[RRWEB_KEY_ENV];
  if (key === undefined || key === "") {
    console.log(missingKeyMessage());
    return 0;
  }

  const host = trimHost(process.env[RRWEB_HOST_ENV] ?? DEFAULT_HOST);
  const state: RunState = { host, key, requestsUsed: 0 };

  section("rrweb.com read API shape probe");
  log(state, `  host: ${host}`);
  log(state, `  bounded to at most ${MAX_REQUESTS} requests, ${POLITE_INTERVAL_MS}ms apart`);

  const base = await probeBasePath(state);
  const recordingsEnvelope =
    base === undefined
      ? { items: [] as readonly unknown[] }
      : await probeRecordingsEnvelope(state, base.listResponse);

  if (base !== undefined) {
    await probeCursor(state, base.listResponse);
  } else {
    pin("ROW 3 Cursor", "FAILED-TO-PIN", "ROW 1 did not pin a working base path");
  }

  await probeEventsEnvelope(state, base?.basePath, recordingsEnvelope.sampleRecordingId);
  await probeErrorShapes(state, base?.basePath, recordingsEnvelope.sampleRecordingId);

  section("SUMMARY");
  for (const entry of pins) {
    console.log(`${entry.status.padEnd(13)} ${entry.row}`);
  }

  await writeNotes(state);
  return 0;
}

process.exit(await main());
