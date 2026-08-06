#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ReplaySource } from "../../packages/adapters/src/index";
import { createPostHogReplaySource } from "../../packages/adapters/src/index";
import { MAX_RESPONSE_BYTES } from "../../packages/adapters/src/http/constants";
import {
  MAX_BLOB_CHUNKS_PER_PULL,
  RECORDINGS_PAGE_LIMIT,
  REQUEST_TIMEOUT_MS,
} from "../../packages/adapters/src/posthog/constants";
import { buildTranscript } from "../../packages/core/src/index";
import { resolveOrganizationForCli } from "../../packages/db/src/admin/index";
import {
  createDb,
  createProjectConnectionsRepo,
  findFirstProjectForOrg,
} from "../../packages/db/src/index";
import type { ReplayEventsResult, TenantContext } from "../../packages/shared/src/index";
import {
  deriveIdentityHmacKey,
  parseBaseEnv,
  resolveCredentialKey,
  tenantContextSchema,
} from "../../packages/shared/src/index";
import type {
  BranchDecision,
  DerivedConstants,
  ProbeSummary,
  PullOutcome,
  RecordingPullRecord,
} from "./lib/m0-pull";
import {
  deriveConstants,
  formatBytes,
  formatBytesExact,
  formatMs,
  formatPercent,
  FR02_TABLE_ROWS,
  FR02_THRESHOLDS,
  groupDigits,
  renderRecordingTable,
  selectBranch,
  summarise,
} from "./lib/m0-pull";

// The overlap is an input, not a measurement this probe takes: it was settled by the
// read-only production query of FR-0.1a and must not be re-derived here.
const MEASURED_JOIN_OVERLAP = 0.579;

const AC_02_MINIMUM_RECORDINGS = 20;

const DEFAULT_LIMIT = 25;

// Twice the FR-0.2 stop band, so a recording that hits it is unambiguously past the band
// rather than borderline. Without it the theoretical ceiling per recording is
// MAX_BLOB_CHUNKS_PER_PULL x REQUEST_TIMEOUT_MS.
const DEFAULT_RECORDING_TIMEOUT_MS = 2 * FR02_THRESHOLDS.stopMs;

const CONNECT_BACKOFF_CEILING_MS = 5_000;

let secretToRedact = "";
const redact = (text: string): string =>
  secretToRedact === "" ? text : text.replaceAll(secretToRedact, "[redacted]");

const USAGE = `M-0 recording-pull probe (O-040 FR-0.1b). Read-only: writes nothing, anywhere.

Usage: bun scripts/spikes/m0-recording-pull.ts [flags]
  --limit <n>              recordings to pull (default ${DEFAULT_LIMIT}; AC-0.2 needs at least ${AC_02_MINIMUM_RECORDINGS})
  --org <id-or-slug>       which organisation to read (only needed when there is more than one)
  --overlap <percent>      join overlap from the FR-0.1a query (default ${(MEASURED_JOIN_OVERLAP * 100).toFixed(1)})
  --recording-timeout <ms> per-recording deadline (default ${DEFAULT_RECORDING_TIMEOUT_MS}; theoretical worst case is ${MAX_BLOB_CHUNKS_PER_PULL} x ${REQUEST_TIMEOUT_MS} ms)
  --help                   print this and stop

Exit codes: 0 a ship branch, 2 a STOP branch, 1 no usable measurement.`;

interface CliFlags {
  readonly limit: number;
  readonly org: string | undefined;
  readonly overlap: number;
  readonly recordingTimeoutMs: number;
  readonly help: boolean;
}

type FlagParseResult =
  { readonly ok: true; readonly flags: CliFlags } | { readonly ok: false; readonly reason: string };

function parseFlags(argv: readonly string[]): FlagParseResult {
  let limit = DEFAULT_LIMIT;
  let org: string | undefined;
  let overlap = MEASURED_JOIN_OVERLAP;
  let recordingTimeoutMs = DEFAULT_RECORDING_TIMEOUT_MS;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);

    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      index += 1;
      return index < argv.length ? argv[index] : undefined;
    };

    switch (name) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--org": {
        const value = takeValue();
        if (value === undefined || value === "") {
          return { ok: false, reason: "--org needs a value, e.g. --org acme" };
        }
        org = value;
        break;
      }
      case "--limit":
      case "--recording-timeout": {
        const raw = takeValue();
        const value = Number(raw);
        if (raw === undefined || !Number.isInteger(value) || value <= 0) {
          return {
            ok: false,
            reason: `${name} must be a positive whole number, got "${raw ?? ""}"`,
          };
        }
        if (name === "--limit") limit = value;
        else recordingTimeoutMs = value;
        break;
      }
      case "--overlap": {
        const raw = takeValue();
        const value = Number(raw);
        if (raw === undefined || !Number.isFinite(value) || value < 0 || value > 100) {
          return {
            ok: false,
            reason: `--overlap must be a percentage between 0 and 100, got "${raw ?? ""}"`,
          };
        }
        overlap = value / 100;
        break;
      }
      default:
        return { ok: false, reason: `unknown flag: ${arg}` };
    }
  }

  return { ok: true, flags: { limit, org, overlap, recordingTimeoutMs, help } };
}

interface ByteMeter {
  bytes: number;
  declaredBytes: number;
  largestResponseBytes: number;
  responses: number;
}

const newMeter = (): ByteMeter => ({
  bytes: 0,
  declaredBytes: 0,
  largestResponseBytes: 0,
  responses: 0,
});

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

type FetchArgs = Parameters<typeof globalThis.fetch>;

// Bytes are counted where they arrive, not estimated from the parsed object, and the meter
// is bound when a request is ISSUED: a straggler from a recording that already hit its
// deadline is charged to that recording rather than polluting the next one's number.
function createMeteredFetch(currentMeter: () => ByteMeter): typeof globalThis.fetch {
  const metered = async (input: FetchArgs[0], init?: FetchArgs[1]): Promise<Response> => {
    const meter = currentMeter();
    const response = await globalThis.fetch(input, init);

    if (NULL_BODY_STATUSES.has(response.status) || response.status < 200 || response.status > 599) {
      return response;
    }

    const body = await response.arrayBuffer();
    meter.bytes += body.byteLength;
    meter.responses += 1;
    meter.largestResponseBytes = Math.max(meter.largestResponseBytes, body.byteLength);

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared)) meter.declaredBytes += declared;

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.set("content-length", String(body.byteLength));

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  return metered as typeof globalThis.fetch;
}

interface ResolvedSource {
  readonly source: ReplaySource;
  readonly host: string;
  readonly organizationName: string;
  readonly personalApiKey: string;
}

type SourceResolution =
  | { readonly ok: true; readonly resolved: ResolvedSource }
  | { readonly ok: false; readonly reason: string };

async function resolveSource(
  db: ReturnType<typeof createDb>,
  org: string | undefined,
  fetchImpl: typeof globalThis.fetch,
): Promise<SourceResolution> {
  const env = parseBaseEnv(process.env);
  const keyResolution = resolveCredentialKey(env);
  if (!keyResolution.ok) {
    return {
      ok: false,
      reason: `the credential key could not be resolved (${keyResolution.reason}), so no organisation's recordings can be read on this installation`,
    };
  }
  const key = keyResolution.key;

  const organisation = await resolveOrganizationForCli(db, org === undefined ? {} : { org });
  if (!organisation.ok) {
    return { ok: false, reason: `no organisation to read (${organisation.reason})` };
  }

  const ctx: TenantContext = tenantContextSchema.parse({
    userId: organisation.organization.ownerUserId,
    organizationId: organisation.organization.id,
    organizationName: organisation.organization.name,
    role: "owner",
  });

  const project = await findFirstProjectForOrg(db, ctx);
  if (project === undefined) {
    return {
      ok: false,
      reason: "that organisation has no project, so nothing has been connected yet",
    };
  }

  const repo = createProjectConnectionsRepo(db, ctx);
  const connection = await repo.getActiveForProject(project.id);
  if (connection === null) {
    return { ok: false, reason: "that project has no active analytics connection" };
  }

  const opened = await repo.openCredentialForProject(project.id, key);
  if (opened === null) {
    return { ok: false, reason: "that project has no active analytics connection" };
  }
  if (!opened.ok) {
    return {
      ok: false,
      reason: `that organisation has a stored analytics credential this installation cannot open (${opened.reason}) — it must be reconnected`,
    };
  }

  const source = createPostHogReplaySource(
    {
      host: connection.host,
      sourceProjectId: connection.sourceProjectId,
      personalApiKey: opened.value,
    },
    {
      fetch: fetchImpl,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      random: () => Math.random(),
      identityHmacKey: deriveIdentityHmacKey(key),
      deadlineExceededAfter: (ms) => ms > CONNECT_BACKOFF_CEILING_MS,
    },
  );

  return {
    ok: true,
    resolved: {
      source,
      host: connection.host,
      organizationName: organisation.organization.name,
      personalApiKey: opened.value,
    },
  };
}

type RaceOutcome =
  | { readonly kind: "result"; readonly result: ReplayEventsResult }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "deadline" };

async function pullOne(
  source: ReplaySource,
  recordingId: string,
  timeoutMs: number,
): Promise<RaceOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settled: Promise<RaceOutcome> = source.pullEvents(recordingId).then(
    (result): RaceOutcome => ({ kind: "result", result }),
    (error: unknown): RaceOutcome => ({ kind: "error", error }),
  );
  const deadline = new Promise<RaceOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "deadline" }), timeoutMs);
  });

  try {
    return await Promise.race([settled, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SummaryRender {
  readonly summary: ProbeSummary;
  readonly branch: BranchDecision;
  readonly derived: DerivedConstants;
  readonly overlap: number;
  readonly recordingTimeoutMs: number;
}

function renderSummaryBlock(input: SummaryRender): string {
  const { summary, branch, derived, overlap, recordingTimeoutMs } = input;

  const lines: string[] = [
    "## M-0 measured (O-040 FR-0.1b)",
    "",
    `Recordings pulled: ${summary.n} (${summary.nPulled} complete, ${summary.nPartial} partial, ${summary.nTimedOut} timed out at ${formatMs(recordingTimeoutMs)}, ${summary.nErrored} errored).`,
    "Every one of them is in the numbers below. None was dropped for being slow.",
    "",
    "Bytes per recording — response bodies as they arrive at the adapter, the same quantity",
    "FR-6's MAX_PULL_BYTES will bound:",
    `  p50 ${formatBytesExact(summary.bytes.p50)}`,
    `  p90 ${formatBytesExact(summary.bytes.p90)}`,
    `  max ${formatBytesExact(summary.bytes.max)}`,
    `  total across the run ${formatBytesExact(summary.totalBytes)}`,
    `  largest single response ${formatBytesExact(summary.largestResponseBytes)}`,
    "",
    "Wall-clock per recording — first request issued to last chunk parsed:",
    `  p50 ${formatMs(summary.wallClock.p50)}`,
    `  p90 ${formatMs(summary.wallClock.p90)}`,
    `  max ${formatMs(summary.wallClock.max)}`,
    "",
    `Join overlap (input, from the FR-0.1a production query, not measured here): ${formatPercent(overlap)}`,
    "",
    "## The FROZEN FR-0.2 branch table",
    "",
    ...FR02_TABLE_ROWS.map((line) => `  ${line}`),
    "",
    `Branch selected: ${branch.branch.toUpperCase()}`,
    `  ${branch.label}`,
    ...branch.reasons.map((reason) => `  because ${reason}`),
    "",
    "## Derived constants (ADD §7)",
    "",
    `  MAX_PULL_BYTES               = ${groupDigits(derived.maxPullBytes)}  (${formatBytes(derived.maxPullBytes)}, p90 bytes rounded up to the next power of two)`,
    `  MEASURED_P90_PULL_MS         = ${groupDigits(derived.measuredP90PullMs)}  (p90 wall-clock, verbatim)`,
    `  RECORDINGS_NARRATED_PER_TICK = ${derived.recordingsNarratedPerTick}  (floor(0.5 x 600000 / MEASURED_P90_PULL_MS), capped at 25)`,
  ];

  if (summary.largestResponseBytes > MAX_RESPONSE_BYTES) {
    lines.push(
      "",
      `One or more single responses exceeded the adapter's ${formatBytes(MAX_RESPONSE_BYTES)} read cap, so those`,
      "bodies were counted here but read as empty by readTextBody — the event counts under-report.",
    );
  }

  if (summary.n < AC_02_MINIMUM_RECORDINGS) {
    lines.push(
      "",
      `WARNING: ${summary.n} recordings is under AC-0.2's floor of ${AC_02_MINIMUM_RECORDINGS}. These numbers do not satisfy the acceptance criterion.`,
    );
  }

  return lines.join("\n");
}

async function main(): Promise<number> {
  const parsed = parseFlags(Bun.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.reason);
    console.error(USAGE);
    return 1;
  }
  const { flags } = parsed;
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const startedAt = new Date().toISOString();
  console.log("M-0 — recording pull cost, read-only. Writes nothing, in Postgres or PostHog.");
  console.log(`Ran at ${startedAt}`);

  const env = parseBaseEnv(process.env);
  const db = createDb(env.DATABASE_URL);

  let meter = newMeter();
  const meteredFetch = createMeteredFetch(() => meter);

  try {
    const resolution = await resolveSource(db, flags.org, meteredFetch);
    if (!resolution.ok) {
      console.error(`\nNo recordings could be read: ${resolution.reason}.`);
      return 1;
    }
    const { source, host, organizationName, personalApiKey } = resolution.resolved;
    secretToRedact = personalApiKey;

    console.log(`Organisation: ${organizationName}`);
    console.log(`Source: ${source.kind} at ${host}`);
    console.log("");

    const listMeter = newMeter();
    meter = listMeter;
    const listStartedMs = performance.now();
    const listed = await source.listRecordings({
      sinceAt: null,
      maxPages: Math.max(1, Math.ceil(flags.limit / RECORDINGS_PAGE_LIMIT)),
    });
    const listElapsedMs = Math.round(performance.now() - listStartedMs);

    const available = listed.ok ? listed.recordings : listed.partialRecordings;
    console.log(
      `Listing: ${available.length} recordings in ${formatMs(listElapsedMs)}, ${formatBytes(listMeter.bytes)} over ${listMeter.responses} responses` +
        (listed.ok
          ? ` (stop: ${listed.stop})`
          : ` — the listing failed part-way: ${redact(listed.failure.message)}`),
    );

    const selected = available.slice(0, flags.limit);
    if (selected.length === 0) {
      console.error("\nThe source listed no recordings, so there is nothing to pull.");
      return 1;
    }
    if (selected.length < AC_02_MINIMUM_RECORDINGS) {
      console.log(
        `\nOnly ${selected.length} recordings are available — AC-0.2 asks for at least ${AC_02_MINIMUM_RECORDINGS}. The run continues so the shortfall is visible in the numbers.`,
      );
    }
    console.log(
      `\nPulling ${selected.length} recordings, ${formatMs(flags.recordingTimeoutMs)} deadline each…\n`,
    );

    const records: RecordingPullRecord[] = [];

    for (const [index, recording] of selected.entries()) {
      const recordingMeter = newMeter();
      meter = recordingMeter;

      const startedMs = performance.now();
      const outcome = await pullOne(source, recording.recordingId, flags.recordingTimeoutMs);
      const wallClockMs = Math.round(performance.now() - startedMs);

      const events =
        outcome.kind === "result"
          ? outcome.result.ok
            ? outcome.result.events
            : outcome.result.partialEvents
          : [];

      const transcriptStartedMs = performance.now();
      const transcript = buildTranscript(events);
      const transcriptMs = Math.round(performance.now() - transcriptStartedMs);

      const pullOutcome: PullOutcome =
        outcome.kind === "deadline"
          ? "timeout"
          : outcome.kind === "error"
            ? "errored"
            : outcome.result.ok
              ? "pulled"
              : "partial";

      const reason =
        outcome.kind === "deadline"
          ? `probe deadline at ${formatMs(flags.recordingTimeoutMs)}`
          : outcome.kind === "error"
            ? redact(describeError(outcome.error))
            : outcome.result.ok
              ? null
              : `${outcome.result.failure.code}: ${redact(outcome.result.failure.message)}`;

      const record: RecordingPullRecord = {
        recordingId: recording.recordingId,
        outcome: pullOutcome,
        bytes: recordingMeter.bytes,
        declaredBytes: recordingMeter.declaredBytes,
        largestResponseBytes: recordingMeter.largestResponseBytes,
        responses: recordingMeter.responses,
        wallClockMs,
        eventCount: events.length,
        actionCount: transcript.actions.length,
        transcriptMs,
        stop: outcome.kind === "result" && outcome.result.ok ? outcome.result.stop : null,
        droppedMalformed: outcome.kind === "result" ? outcome.result.droppedMalformed : 0,
        reason,
      };
      records.push(record);

      console.log(
        `  ${index + 1}/${selected.length} ${record.recordingId}: ${record.outcome}, ${formatBytes(record.bytes)} in ${formatMs(record.wallClockMs)}, ${groupDigits(record.eventCount)} events, ${groupDigits(record.actionCount)} actions${record.reason === null ? "" : ` — ${record.reason}`}`,
      );
    }

    const summary = summarise(records);
    if (summary === null) {
      console.error("\nNo recording produced a measurement, so there are no numbers to report.");
      return 1;
    }

    const branch = selectBranch({
      p90Bytes: summary.bytes.p90,
      p90Ms: summary.wallClock.p90,
      overlap: flags.overlap,
    });
    const derived = deriveConstants(summary.bytes.p90, summary.wallClock.p90);

    console.log(`\n${renderRecordingTable(records)}`);
    console.log(
      `\n${renderSummaryBlock({
        summary,
        branch,
        derived,
        overlap: flags.overlap,
        recordingTimeoutMs: flags.recordingTimeoutMs,
      })}`,
    );

    const runPath = join(
      "local",
      "spikes",
      `m0-recording-pull-${startedAt.replaceAll(":", "-")}.json`,
    );
    await mkdir(dirname(runPath), { recursive: true });
    await writeFile(
      runPath,
      `${JSON.stringify(
        {
          metadata: { startedAt, host, organizationName, sourceKind: source.kind },
          config: {
            limit: flags.limit,
            overlap: flags.overlap,
            recordingTimeoutMs: flags.recordingTimeoutMs,
          },
          listing: { count: available.length, bytes: listMeter.bytes, elapsedMs: listElapsedMs },
          records,
          summary,
          branch,
          derived,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`\nRaw per-recording JSON written to ${runPath}`);

    if (summary.n < AC_02_MINIMUM_RECORDINGS) return 1;
    return branch.stops ? 2 : 0;
  } finally {
    await db.$client.end();
  }
}

const exitCode = await main().catch((error: unknown) => {
  console.error(`The probe stopped: ${redact(describeError(error))}`);
  return 1;
});
process.exit(exitCode);
