#!/usr/bin/env bun

import { join } from "node:path";

import { findBrowser, runRecordingTrial } from "./lib/browser";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TRIALS,
  EVENT_NAMES,
} from "./lib/constants";
import { formatCredentialError, validateCredentials } from "./lib/env";
import { createRunPersister } from "./lib/persist";
import { captureEvent, pollEventOnce, pollRecordingOnce } from "./lib/posthog-client";
import {
  renderDecisionDocBlock,
  renderSummaryTable,
  renderTrialProgressLine,
  renderVerdictLine,
} from "./lib/report";
import { computeStats } from "./lib/stats";
import {
  runLegs,
  runTrialLoop,
  type CaptureResult,
  type LegSpec,
  type TrialConfig,
  type TrialDeps,
} from "./lib/trial";
import type { LegResult, RecordingMode, RunFile, SignalType, TrialRecord } from "./lib/types";

const LEG_ORDER: readonly SignalType[] = ["custom-event", "exception", "recording"];

const RECORDING_TRIAL_DURATION_MS = 15_000;

const RECORDING_FALLBACK_THRESHOLD = 3;

const USAGE = `Usage: bun scripts/spikes/m0-posthog-latency.ts [flags]
  --trials <n>          trials per leg (default ${DEFAULT_TRIALS})
  --poll-interval <ms>  delay between poll ticks (default ${DEFAULT_POLL_INTERVAL_MS})
  --timeout <ms>        per-trial cap in ms (default ${DEFAULT_TIMEOUT_MS})
  --legs <csv>          any of events,exceptions,recordings (default all)
  --manual-recording    force the recording leg into manual mode`;

interface CliFlags {
  readonly trials: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly legs: readonly SignalType[];
  readonly manualRecording: boolean;
}

type FlagParseResult =
  { readonly ok: true; readonly flags: CliFlags } | { readonly ok: false; readonly reason: string };

function signalForLegName(name: string): SignalType | undefined {
  switch (name) {
    case "events":
      return "custom-event";
    case "exceptions":
      return "exception";
    case "recordings":
      return "recording";
    default:
      return undefined;
  }
}

function parseFlags(argv: readonly string[]): FlagParseResult {
  let trials = DEFAULT_TRIALS;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let legs: readonly SignalType[] = LEG_ORDER;
  let manualRecording = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      i += 1;
      return i < argv.length ? argv[i] : undefined;
    };

    switch (name) {
      case "--trials":
      case "--poll-interval":
      case "--timeout": {
        const raw = takeValue();
        if (raw === undefined || raw === "") {
          return { ok: false, reason: `${name} needs a value, e.g. ${name} 10` };
        }
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          return {
            ok: false,
            reason: `${name} must be a positive whole number, got "${raw}"`,
          };
        }
        if (name === "--trials") trials = value;
        else if (name === "--poll-interval") pollIntervalMs = value;
        else timeoutMs = value;
        break;
      }
      case "--legs": {
        const raw = takeValue();
        if (raw === undefined || raw === "") {
          return {
            ok: false,
            reason: "--legs needs a value, e.g. --legs events,recordings",
          };
        }
        const selected = new Set<SignalType>();
        for (const part of raw.split(",")) {
          const legName = part.trim();
          const signal = signalForLegName(legName);
          if (signal === undefined) {
            return {
              ok: false,
              reason: `--legs got unknown leg "${legName}" — valid legs: events, exceptions, recordings`,
            };
          }
          selected.add(signal);
        }

        legs = LEG_ORDER.filter((signal) => selected.has(signal));
        break;
      }
      case "--manual-recording": {
        if (inline !== undefined) {
          return { ok: false, reason: "--manual-recording takes no value" };
        }
        manualRecording = true;
        break;
      }
      default:
        return { ok: false, reason: `unknown flag: ${arg}` };
    }
  }

  return {
    ok: true,
    flags: { trials, pollIntervalMs, timeoutMs, legs, manualRecording },
  };
}

function deriveHostRegion(host: string): string {
  try {
    const { hostname } = new URL(host);
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "self-hosted";
    }
    if (hostname === "posthog.com" || hostname.endsWith(".posthog.com")) {
      const label = hostname.split(".")[0];
      return label === "posthog" ? "cloud" : label;
    }
    return "self-hosted";
  } catch {
    return "unknown";
  }
}

function exceptionProps(marker: string): Readonly<Record<string, unknown>> {
  return {
    $exception_list: [
      {
        type: "GmSpikeSyntheticError",
        value: `Synthetic spike exception for trial marker ${marker}`,
        mechanism: { handled: true, synthetic: true },
        stacktrace: {
          type: "raw",
          frames: [
            {
              filename: "scripts/spikes/m0-posthog-latency.ts",
              function: "exceptionProps",
              lineno: 1,
              colno: 1,
              in_app: true,
            },
          ],
        },
      },
    ],
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const now = (): number => Date.now();
const markerFactory = (): string => crypto.randomUUID();

async function main(): Promise<number> {
  const flagResult = parseFlags(Bun.argv.slice(2));
  if (!flagResult.ok) {
    console.error(flagResult.reason);
    console.error(USAGE);
    return 1;
  }
  const { flags } = flagResult;

  const gate = validateCredentials(process.env);
  if (!gate.ok) {
    console.error(formatCredentialError(gate.missing));
    return 1;
  }
  const { creds } = gate;

  const runStartedAt = new Date().toISOString();
  const hostRegion = deriveHostRegion(creds.host);

  const persister = createRunPersister(runStartedAt);
  let saved = false;

  const allTrials: TrialRecord[] = [];
  let recordingRan = false;
  let recordingMode: RecordingMode = "automated";

  const saveRun = async (): Promise<void> => {
    const runFile: RunFile = {
      metadata: { startedAt: runStartedAt, hostRegion },
      config: {
        trialsPerLeg: flags.trials,
        pollIntervalMs: flags.pollIntervalMs,
        timeoutMs: flags.timeoutMs,
        legs: flags.legs,

        ...(recordingRan ? { recordingMode } : {}),
      },
      trials: [...allTrials],
    };
    await persister.save(runFile);
    saved = true;
  };

  const onTrialComplete = async (record: TrialRecord): Promise<void> => {
    allTrials.push(record);
    await saveRun();
    console.log(renderTrialProgressLine(record));
  };

  const trialConfigFor = (signalType: SignalType): TrialConfig => ({
    signalType,
    trials: flags.trials,
    pollIntervalMs: flags.pollIntervalMs,
    timeoutMs: flags.timeoutMs,
  });

  const eventLeg: LegSpec = {
    signalType: "custom-event",
    run: async () => {
      console.log(`\ncustom events leg: running ${flags.trials} trials…`);
      const deps: TrialDeps = {
        capture: (marker) => captureEvent(creds, EVENT_NAMES.customEvent, marker),
        poll: (marker) => pollEventOnce(creds, marker),
        sleep,
        now,
        markerFactory,
        onTrialComplete,
      };
      const records = await runTrialLoop(trialConfigFor("custom-event"), deps);
      await saveRun();
      return records;
    },
  };

  const exceptionLeg: LegSpec = {
    signalType: "exception",
    run: async () => {
      console.log(`\nexceptions leg: running ${flags.trials} trials…`);
      const deps: TrialDeps = {
        capture: (marker) =>
          captureEvent(creds, EVENT_NAMES.exception, marker, exceptionProps(marker)),
        poll: (marker) => pollEventOnce(creds, marker),
        sleep,
        now,
        markerFactory,
        onTrialComplete,
      };
      const records = await runTrialLoop(trialConfigFor("exception"), deps);
      await saveRun();
      return records;
    },
  };

  const recordingLeg: LegSpec = {
    signalType: "recording",
    run: async () => {
      recordingRan = true;
      const browserPath = flags.manualRecording ? null : findBrowser(process.env);
      recordingMode = browserPath === null ? "manual" : "automated";

      console.log(`\nrecordings leg: running ${flags.trials} trials…`);
      if (recordingMode === "automated" && browserPath !== null) {
        console.log(`recordings leg: automated mode (browser: ${browserPath})`);
      } else {
        const why = flags.manualRecording
          ? "--manual-recording flag set"
          : "no Chromium-family browser found (set CHROME_PATH to point at one)";
        console.log(`recordings leg: manual mode — ${why}.`);
      }

      const pageHtml = await Bun.file(join(import.meta.dir, "recording-page.html")).text();

      const server = Bun.serve({
        port: 0,
        hostname: "localhost",
        fetch: (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/") {
            return new Response(pageHtml, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
          if (url.pathname === "/go") {
            const marker = url.searchParams.get("marker") ?? "";
            return Response.redirect(pageUrlFor(marker), 302);
          }
          return new Response("not found", { status: 404 });
        },
      });

      const pageUrlFor = (marker: string): string =>
        `http://localhost:${server.port}/?host=${encodeURIComponent(creds.host)}` +
        `&key=${encodeURIComponent(creds.projectApiKey)}` +
        `&marker=${encodeURIComponent(marker)}`;

      const manualInstructions = (marker: string): string =>
        [
          "",
          "Manual recording trial — do this now:",
          `  1. Open this URL in any browser on this machine: http://localhost:${server.port}/go?marker=${encodeURIComponent(marker)}`,
          `  2. Interact with the page for about ${Math.round(RECORDING_TRIAL_DURATION_MS / 1000)} seconds (click around, scroll).`,
          "  3. Close the tab.",
          `The harness now polls PostHog until the recording is listed (up to ${Math.round(flags.timeoutMs / 1000)}s).`,
        ].join("\n");

      let consecutiveUnretrieved = 0;

      const deps: TrialDeps = {
        capture: async (marker): Promise<CaptureResult> => {
          if (recordingMode === "automated" && browserPath !== null) {
            return runRecordingTrial(browserPath, pageUrlFor(marker), RECORDING_TRIAL_DURATION_MS);
          }
          console.log(manualInstructions(marker));
          return { ok: true };
        },
        poll: (marker) => pollRecordingOnce(creds, marker),
        sleep,
        now,
        markerFactory,
        onTrialComplete: async (record) => {
          const stamped: TrialRecord = { ...record, mode: recordingMode };

          if (record.outcome === "retrieved") {
            consecutiveUnretrieved = 0;
          } else {
            consecutiveUnretrieved += 1;
            if (
              recordingMode === "automated" &&
              consecutiveUnretrieved >= RECORDING_FALLBACK_THRESHOLD
            ) {
              recordingMode = "manual";
              console.log(
                `recordings leg: ${RECORDING_FALLBACK_THRESHOLD} consecutive automated trials produced no listed recording — switching to manual mode (ADD D-2 fallback).`,
              );
            }
          }
          await onTrialComplete(stamped);
        },
      };

      try {
        const records = await runTrialLoop(trialConfigFor("recording"), deps);
        await saveRun();
        return records;
      } finally {
        await server.stop(true);
      }
    },
  };

  const legByType: Readonly<Record<SignalType, LegSpec>> = {
    "custom-event": eventLeg,
    exception: exceptionLeg,
    recording: recordingLeg,
  };
  const selectedSpecs = flags.legs.map((signal) => legByType[signal]);

  const results = await runLegs(selectedSpecs);

  const resultBySignal = new Map<SignalType, LegResult>(
    results.map((result) => [result.signalType, result]),
  );
  const displayLegs: LegResult[] = LEG_ORDER.map(
    (signal) =>
      resultBySignal.get(signal) ?? {
        signalType: signal,
        status: "not-run",
        trials: [],
      },
  );

  console.log("");
  for (const leg of displayLegs) {
    console.log(renderVerdictLine(leg, computeStats([...leg.trials])));

    if (leg.status === "failed") {
      const completedForLeg = allTrials.filter(
        (trial) => trial.signalType === leg.signalType,
      ).length;
      if (completedForLeg > 0) {
        console.log(
          `  failed after ${completedForLeg} of ${flags.trials} trials — completed trials are preserved in the run file (${persister.path})`,
        );
      }
    }
  }
  console.log(`\n${renderSummaryTable(displayLegs)}`);
  console.log(`\n${renderDecisionDocBlock(displayLegs)}`);
  console.log(
    saved
      ? `\nRaw trial JSON written to ${persister.path}`
      : "\nNo trials completed — no run file was written.",
  );

  const completedCount = results.filter((result) => result.status === "completed").length;
  const failedCount = results.filter((result) => result.status === "failed").length;
  if (failedCount === 0) return 0;
  return completedCount === 0 ? 1 : 2;
}

const exitCode = await main().catch((error: unknown) => {
  if (error instanceof Error && error.name === "AuthError") {
    console.error(error.message);
  } else {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return 1;
});
process.exit(exitCode);
