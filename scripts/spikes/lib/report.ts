// Pure renderers (ADD §4 file 12, D-9). Plain-English bar throughout: every
// count carries its denominator; "p50"/"p90" appear only alongside their
// plain-English equivalents. Renderers distinguish "0 of N retrieved",
// "leg failed", and "leg not run" (D-5).

import { computeStats } from "./stats";
import type { LegResult, SignalType, StatsResult, TrialRecord } from "./types";

/** Plain-English display names for the three signal legs (FR-12). */
const SIGNAL_LABELS: Record<SignalType, string> = {
  "custom-event": "custom events",
  exception: "exceptions",
  recording: "recordings",
};

/** Formats milliseconds as seconds to one decimal, e.g. 3200 → "3.2s". */
function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)}s`;
}

/**
 * The timeout cap (in ms) the leg's trials ran under, read off the first
 * trial's recorded poll params. Undefined when the leg has no trials.
 */
function legTimeoutMs(leg: LegResult): number | undefined {
  return leg.trials[0]?.pollParams.timeoutMs;
}

/**
 * One per-trial progress line — the CLI's "loading state" during long runs
 * (D-6), e.g. trial index, outcome, and elapsed ms.
 */
export function renderTrialProgressLine(record: TrialRecord): string {
  const label = SIGNAL_LABELS[record.signalType];
  const trial = `trial ${record.trialIndex + 1}`;

  switch (record.outcome) {
    case "retrieved": {
      const elapsed =
        record.satisfyingEndpoint !== undefined
          ? record.elapsedMsByEndpoint[record.satisfyingEndpoint]
          : undefined;
      const via =
        record.satisfyingEndpoint !== undefined
          ? ` via ${record.satisfyingEndpoint}`
          : "";
      const timing = elapsed !== undefined ? ` in ${seconds(elapsed)}` : "";
      return `${label} ${trial}: retrieved${timing}${via}`;
    }
    case "timed-out":
      return `${label} ${trial}: timed out at ${seconds(record.pollParams.timeoutMs)}`;
    case "errored":
      return `${label} ${trial}: errored`;
  }
}

/**
 * FR-12 verdict line, e.g. "custom events: retrievable in 3.2s median across
 * 20 trials (worst: 8.1s, 2 timed out at 120s)". For failed / not-run legs it
 * says so explicitly instead of rendering numbers; a completed leg with zero
 * retrieved trials reports "0 of N" from the leg's own records (D-5).
 */
export function renderVerdictLine(leg: LegResult, stats: StatsResult): string {
  const label = SIGNAL_LABELS[leg.signalType];

  if (leg.status === "failed") {
    const reason =
      leg.failureReason !== undefined ? ` (${leg.failureReason})` : "";
    return `${label}: leg failed — no numbers to report${reason}`;
  }

  if (leg.status === "not-run") {
    return `${label}: not run`;
  }

  if (stats.kind === "no-data") {
    // Completed leg, zero retrieved: counts come from the leg's own records,
    // never from the no-data marker (D-5).
    const attempted = leg.trials.length;
    const timeoutMs = legTimeoutMs(leg);
    const cap = timeoutMs !== undefined ? ` at the ${seconds(timeoutMs)} timeout` : "";
    return `${label}: 0 of ${attempted} trials retrieved${cap} — no latency numbers to report`;
  }

  const worstParts = [`worst: ${seconds(stats.max)}`];
  if (stats.nTimedOut > 0) {
    const timeoutMs = legTimeoutMs(leg);
    const cap = timeoutMs !== undefined ? ` at ${seconds(timeoutMs)}` : "";
    worstParts.push(`${stats.nTimedOut} timed out${cap}`);
  }
  if (stats.nErrored > 0) {
    worstParts.push(`${stats.nErrored} errored`);
  }

  return `${label}: retrievable in ${seconds(stats.p50)} median across ${stats.n} trials (${worstParts.join(", ")})`;
}

/**
 * FR-13 summary table across all legs. Values are recomputed from each leg's
 * own trial records via the stats helper, so the table can never drift from
 * the persisted JSON (report.test.ts asserts the round-trip).
 */
export function renderSummaryTable(legs: readonly LegResult[]): string {
  const header = [
    "signal          p50 (median)  p90     worst   trials  timed out  errored",
    "------          ------------  ---     -----   ------  ---------  -------",
  ];

  const rows = legs.map((leg) => {
    const label = SIGNAL_LABELS[leg.signalType].padEnd(16);

    if (leg.status === "failed") {
      return `${label}leg failed`;
    }
    if (leg.status === "not-run") {
      return `${label}not run`;
    }

    const stats = computeStats([...leg.trials]);
    if (stats.kind === "no-data") {
      return `${label}0 of ${leg.trials.length} trials retrieved — no latency numbers`;
    }

    return [
      label,
      seconds(stats.p50).padEnd(14),
      seconds(stats.p90).padEnd(8),
      seconds(stats.max).padEnd(8),
      String(stats.n).padEnd(8),
      String(stats.nTimedOut).padEnd(11),
      String(stats.nErrored),
    ].join("");
  });

  return [...header, ...rows].join("\n");
}

/** One leg's markdown section for the decision-doc results block. */
function renderLegDocSection(leg: LegResult): string {
  const label = SIGNAL_LABELS[leg.signalType];
  const lines = [`### ${label}`, ""];

  if (leg.status === "failed") {
    const reason =
      leg.failureReason !== undefined ? `: ${leg.failureReason}` : "";
    lines.push(`This leg failed before producing numbers${reason}.`);
    return lines.join("\n");
  }

  if (leg.status === "not-run") {
    lines.push("This leg was not run.");
    return lines.join("\n");
  }

  const attempted = leg.trials.length;
  const stats = computeStats([...leg.trials]);

  if (stats.kind === "no-data") {
    lines.push(
      `- 0 of ${attempted} trials retrieved — no latency numbers to report.`,
    );
    return lines.join("\n");
  }

  lines.push(
    `- ${stats.nRetrieved} of ${stats.n} trials retrieved.`,
    `- ${stats.nTimedOut} of ${stats.n} trials timed out.`,
  );
  if (stats.nErrored > 0) {
    lines.push(`- ${stats.nErrored} of ${stats.n} trials errored.`);
  }
  lines.push(
    `- Median (p50): ${seconds(stats.p50)} — half the trials were at or under this.`,
    `- p90 (9 out of 10 trials were at or under this): ${seconds(stats.p90)}.`,
    `- Worst case: ${seconds(stats.max)}.`,
  );

  return lines.join("\n");
}

/**
 * The paste-ready markdown results block for
 * docs/decisions/0001-posthog-retrieval-latency.md (D-9): per-leg p50/p90/max
 * with plain-English equivalents and every count carrying its denominator.
 * Run date and host region are left as fill-in slots — this renderer sees only
 * leg results, and the run file carries a region string only (never keys,
 * never the project ID).
 */
export function renderDecisionDocBlock(legs: readonly LegResult[]): string {
  const sections = legs.map((leg) => renderLegDocSection(leg));

  return [
    "## Results",
    "",
    "Run date: _fill from run file `metadata.startedAt`_",
    "Host region: _fill from run file `metadata.hostRegion`_",
    "",
    ...sections,
  ].join("\n\n");
}
