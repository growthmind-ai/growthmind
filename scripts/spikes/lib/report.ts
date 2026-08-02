import { computeStats } from "./stats";
import type { LegResult, SignalType, StatsResult, TrialRecord } from "./types";

const SIGNAL_LABELS: Record<SignalType, string> = {
  "custom-event": "custom events",
  exception: "exceptions",
  recording: "recordings",
};

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)}s`;
}

function legTimeoutMs(leg: LegResult): number | undefined {
  return leg.trials[0]?.pollParams.timeoutMs;
}

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
        record.satisfyingEndpoint !== undefined ? ` via ${record.satisfyingEndpoint}` : "";
      const timing = elapsed !== undefined ? ` in ${seconds(elapsed)}` : "";
      return `${label} ${trial}: retrieved${timing}${via}`;
    }
    case "timed-out":
      return `${label} ${trial}: timed out at ${seconds(record.pollParams.timeoutMs)}`;
    case "errored":
      return `${label} ${trial}: errored`;
  }
}

export function renderVerdictLine(leg: LegResult, stats: StatsResult): string {
  const label = SIGNAL_LABELS[leg.signalType];

  if (leg.status === "failed") {
    const reason = leg.failureReason !== undefined ? ` (${leg.failureReason})` : "";
    return `${label}: leg failed — no numbers to report${reason}`;
  }

  if (leg.status === "not-run") {
    return `${label}: not run`;
  }

  if (stats.kind === "no-data") {
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

function renderLegDocSection(leg: LegResult): string {
  const label = SIGNAL_LABELS[leg.signalType];
  const lines = [`### ${label}`, ""];

  if (leg.status === "failed") {
    const reason = leg.failureReason !== undefined ? `: ${leg.failureReason}` : "";
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
    lines.push(`- 0 of ${attempted} trials retrieved — no latency numbers to report.`);
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
