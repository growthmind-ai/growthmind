import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { manifestPath, readManifest, writeManifest, type Manifest } from "./run-manifest";

export interface RebuildInput {
  readonly runsDir: string;
  readonly sourceRunId: string;
  readonly targetRunId: string;
}

export class RunAlreadyExistsError extends Error {}

/**
 * Point a new run id at an existing run's recordings, so the same sessions can go through a
 * changed pipeline and be compared. Re-recording would move the personas as well as the code,
 * and there would be nothing left to attribute a difference to.
 */
export function cloneRunForRebuild(input: RebuildInput): string {
  if (input.sourceRunId === input.targetRunId) {
    throw new Error("a rebuild needs a run id of its own, or the comparison has one side");
  }

  const sourceDir = join(input.runsDir, input.sourceRunId);
  const targetDir = join(input.runsDir, input.targetRunId);

  if (!existsSync(manifestPath(sourceDir))) {
    throw new Error(`no manifest.json in ${sourceDir}; there is nothing to rebuild from`);
  }

  if (existsSync(manifestPath(targetDir))) {
    const existing = readManifest(targetDir);
    if (existing.recordingsFrom === input.sourceRunId) return targetDir;

    throw new RunAlreadyExistsError(
      `run ${input.targetRunId} already exists and was not rebuilt from ${input.sourceRunId}; pick another run id`,
    );
  }

  const source = readManifest(sourceDir);

  // The recordings stay where they were written. Their path in the source manifest is absolute
  // and from another machine's checkout as often as not, so it is re-derived rather than trusted.
  const sessions = source.sessions.map((session) => {
    const canonical = join(sourceDir, "sessions", session.sessionId, "session.json");
    return existsSync(canonical) ? { ...session, sessionPath: canonical } : session;
  });

  const rebuilt: Manifest = {
    ...source,
    runId: input.targetRunId,
    recordingsFrom: input.sourceRunId,
    sessions,
  };

  mkdirSync(targetDir, { recursive: true });
  writeManifest(targetDir, rebuilt);

  return targetDir;
}
