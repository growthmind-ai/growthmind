import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cloneRunForRebuild, RunAlreadyExistsError } from "../src/rebuild";
import { readManifest, writeManifest, type Manifest } from "../src/run-manifest";

const RUNS = mkdtempSync(join(tmpdir(), "eval-rebuild-"));

afterAll(() => {
  rmSync(RUNS, { recursive: true, force: true });
});

function recordedRun(runId: string): string {
  const runDir = join(RUNS, runId);
  const sessionDir = join(runDir, "sessions", "s-one");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "session.json"), JSON.stringify({ events: [] }));

  writeManifest(runDir, {
    runId,
    scenarioId: "activation-from-sign-in",
    scenarioTitle: "test",
    startUrl: "http://localhost:3000/sign-in",
    modelIds: { persona: "a", analyser: "b", judge: "b" },
    sessions: [
      {
        sessionId: "s-one",
        // A path from whichever machine recorded it, which is exactly what must not be trusted.
        sessionPath: "D:\\somewhere-else\\runs\\gone\\sessions\\s-one\\session.json",
      },
    ],
  } as unknown as Manifest);

  return runDir;
}

describe("a corpus rebuilds into a new run id from another run's recordings", () => {
  const sourceDir = recordedRun("corpus-source");

  it("points the new run at the recordings that already exist, copying none of them", () => {
    const targetDir = cloneRunForRebuild({
      runsDir: RUNS,
      sourceRunId: "corpus-source",
      targetRunId: "corpus-rebuilt",
    });

    const rebuilt = readManifest(targetDir);

    expect(rebuilt.runId).toBe("corpus-rebuilt");
    expect(rebuilt.recordingsFrom).toBe("corpus-source");
    expect(rebuilt.sessions[0]?.sessionPath).toBe(
      join(sourceDir, "sessions", "s-one", "session.json"),
    );
    expect(existsSync(join(targetDir, "sessions"))).toBe(false);
  });

  it("keeps the personas, the scenario and the models of the run it rebuilds", () => {
    const source = readManifest(sourceDir);
    const rebuilt = readManifest(join(RUNS, "corpus-rebuilt"));

    expect(rebuilt.scenarioId).toBe(source.scenarioId);
    expect(rebuilt.startUrl).toBe(source.startUrl);
    expect(rebuilt.sessions.map((entry) => entry.sessionId)).toEqual(
      source.sessions.map((entry) => entry.sessionId),
    );
  });

  it("is safe to run twice, so a rebuild can be re-analysed", () => {
    expect(() =>
      cloneRunForRebuild({
        runsDir: RUNS,
        sourceRunId: "corpus-source",
        targetRunId: "corpus-rebuilt",
      }),
    ).not.toThrow();
  });

  it("refuses to write over a run that holds recordings of its own", () => {
    recordedRun("corpus-other");

    expect(() =>
      cloneRunForRebuild({
        runsDir: RUNS,
        sourceRunId: "corpus-source",
        targetRunId: "corpus-other",
      }),
    ).toThrow(RunAlreadyExistsError);
  });

  it("refuses a rebuild onto the run it came from, which would leave one side to compare", () => {
    expect(() =>
      cloneRunForRebuild({
        runsDir: RUNS,
        sourceRunId: "corpus-source",
        targetRunId: "corpus-source",
      }),
    ).toThrow();
  });
});
