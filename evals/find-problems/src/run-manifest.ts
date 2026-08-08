import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PersonaSessionResult } from "./session/run-persona";

/**
 * What was true of the analyser when it produced this run's analysis. It is written at analyse
 * time and read back by the report, so a scorecard can never be quoted without its arm.
 */
export interface AnalysisConditions {
  readonly countsGiven: boolean;
  readonly exitReasonsShown: boolean;
  readonly recordingsFrom: string | null;
  readonly analysedAt: string;
}

export interface Manifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly startUrl: string;
  readonly modelIds: Readonly<Record<string, string>>;
  readonly sessions: readonly PersonaSessionResult[];

  /** Set only on a run rebuilt from another run's recordings; absent on a recorded run. */
  readonly recordingsFrom?: string;

  /** Absent until the run has been analysed, and on runs analysed before arms were recorded. */
  readonly conditions?: AnalysisConditions;
}

/** The arm in one line, for a reader who has only the report in front of them. */
export function describeConditions(conditions: AnalysisConditions | undefined): string {
  if (conditions === undefined) {
    return "Conditions were not recorded for this run, so which arm produced it is not known from the run alone.";
  }

  return [
    conditions.countsGiven
      ? "The analyser was given the counts the harness made."
      : "The counts were withheld from the analyser, which was asked to find the problems unaided.",
    conditions.recordingsFrom === null
      ? "The transcript was built from this run's own recordings."
      : `The transcript was rebuilt from ${conditions.recordingsFrom}'s recordings.`,
    conditions.exitReasonsShown ? "Exit reasons were shown." : "Exit reasons were not shown.",
    `Analysed ${conditions.analysedAt}.`,
  ].join(" ");
}

export function manifestPath(runDir: string): string {
  return join(runDir, "manifest.json");
}

export function readManifest(runDir: string): Manifest {
  return JSON.parse(readFileSync(manifestPath(runDir), "utf8")) as Manifest;
}

export function writeManifest(runDir: string, manifest: Manifest): void {
  writeFileSync(manifestPath(runDir), JSON.stringify(manifest, null, 2));
}
