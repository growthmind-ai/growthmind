import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { analyseCorpus } from "./analyse/analyse";
import {
  corpusAnalysisInputSchema,
  type AssessedProblem,
  type CorpusAnalysisInput,
} from "./analyse/types";
import { readEvalEnv } from "./env";
import { createEvalModels } from "./models";
import { createPersonaBrain } from "./persona/brain";
import { renderReport } from "./report";
import { loadScenario, resolveFacts } from "./scenario/load";
import { loadAnswerKey } from "./score/answer-key";
import { judgeRecommendations, judgeUnresolvedMatches } from "./score/judge";
import { matchDeterministically } from "./score/match";
import { scoreCorpus } from "./score/score";
import { assertHarnessNoiseUnchanged, attributeConsoleErrors } from "./session/console-attribution";
import { runPersonaSession, type PersonaSessionResult } from "./session/run-persona";
import { summariseRecordedSession } from "./session/summarise";

const PACKAGE_DIR = join(import.meta.dir, "..");
const SCENARIOS_DIR = join(import.meta.dir, "scenarios");
const RUNS_DIR = join(PACKAGE_DIR, "runs");
const DRIVER_PATH = join(PACKAGE_DIR, "driver.mjs");

function flag(name: string, fallback: string | null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface Manifest {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly startUrl: string;
  readonly modelIds: Readonly<Record<string, string>>;
  readonly sessions: readonly PersonaSessionResult[];
}

function manifestPath(runDir: string): string {
  return join(runDir, "manifest.json");
}

function readManifest(runDir: string): Manifest {
  return JSON.parse(readFileSync(manifestPath(runDir), "utf8")) as Manifest;
}

async function record(): Promise<string> {
  const env = readEvalEnv();
  const models = createEvalModels(env);
  const scenarioId = flag("scenario", "activation-from-sign-in") ?? "activation-from-sign-in";
  const loaded = loadScenario(join(SCENARIOS_DIR, scenarioId));
  // Better Auth rejects any origin that is not BETTER_AUTH_URL, so a sign-in from localhost
  // 403s whenever the dev server is reached through a tunnel. The origin is a parameter rather
  // than a committed constant because this repo is public and the tunnel host is not.
  const baseUrl = flag("base-url", process.env["EVAL_BASE_URL"] ?? null);
  const scenario =
    baseUrl === null
      ? loaded
      : { ...loaded, startUrl: new URL(new URL(loaded.startUrl).pathname, baseUrl).toString() };

  const runId = flag("run", null) ?? `${scenarioId}-${Date.now().toString(36)}`;
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const only = flag("persona", null);
  const chosen = only === null ? scenario.personas : scenario.personas.filter((p) => p.id === only);

  say(`run ${runId}: ${String(chosen.length)} personas against ${scenario.startUrl}`);

  const sessions: PersonaSessionResult[] = [];

  for (const persona of chosen) {
    const sessionId = `s-${persona.id}`;
    const outDir = join(runDir, "sessions", sessionId);
    say(`  ${sessionId}: ${persona.label}`);

    const result = await runPersonaSession({
      scenario,
      persona,
      facts: resolveFacts(persona, runId),
      brain: createPersonaBrain(models.persona, persona),
      outDir,
      driverPath: DRIVER_PATH,
      sessionId,
      onStep: (step) => {
        say(
          `    ${String(step.step)} ${step.decision.action}${step.decision.elementIndex === null ? "" : ` [${String(step.decision.elementIndex)}]`} (${step.decision.feeling}) — ${step.decision.thinking}`,
        );
      },
    });

    say(
      `    → ${result.outcome}: ${result.outcomeReason ?? "(no reason)"} [${String(result.eventCount)} rrweb events]`,
    );

    // Before the next persona, not after all of them: a contaminated run is not worth recording.
    const appOrigin = new URL(scenario.startUrl).origin;
    assertHarnessNoiseUnchanged(result.sessionId, result.consoleErrors, appOrigin);

    const attributed = attributeConsoleErrors(result.consoleErrors, appOrigin);
    say(
      `    console: ${String(attributed.app.length)} from the app (evidence), ${String(attributed.harness.length)} known harness noise, ${String(attributed.offOrigin.length)} from another site (neither is evidence)`,
    );
    for (const message of attributed.app) say(`      app: ${message}`);

    sessions.push(result);
  }

  const manifest: Manifest = {
    runId,
    scenarioId,
    scenarioTitle: scenario.title,
    startUrl: scenario.startUrl,
    modelIds: models.ids,
    sessions,
  };
  writeFileSync(manifestPath(runDir), JSON.stringify(manifest, null, 2));

  return runId;
}

function buildCorpus(runDir: string, includeExitReason: boolean): CorpusAnalysisInput {
  const manifest = readManifest(runDir);

  const appOrigin = new URL(manifest.startUrl).origin;

  const summaries = manifest.sessions.map((session) => {
    const read = summariseRecordedSession(session, { includeExitReason, appOrigin });
    say(
      `  ${session.sessionId}: ${String(read.eventsAccepted)} of ${String(read.eventsSeen)} events passed the production schema, ${String(read.summary.beats.length)} beats`,
    );
    return read.summary;
  });

  const corpus = corpusAnalysisInputSchema.parse({
    scenarioId: manifest.scenarioId,
    startUrl: manifest.startUrl,
    sessionsTotal: summaries.length,
    sessions: summaries,
  });

  writeFileSync(join(runDir, "corpus.json"), JSON.stringify(corpus, null, 2));
  return corpus;
}

async function analyse(runDir: string): Promise<readonly AssessedProblem[]> {
  const env = readEvalEnv();
  const models = createEvalModels(env);
  const corpus = buildCorpus(runDir, has("exit-reasons"));

  const result = await analyseCorpus(models.analyser, corpus);
  writeFileSync(
    join(runDir, "analysis.json"),
    JSON.stringify({ problems: result.problems, prompt: result.prompt }, null, 2),
  );

  say(`analyser proposed ${String(result.problems.length)} problems`);
  return result.problems;
}

async function score(runDir: string): Promise<void> {
  const env = readEvalEnv();
  const models = createEvalModels(env);
  const manifest = readManifest(runDir);

  const analysisPath = join(runDir, "analysis.json");
  if (!existsSync(analysisPath))
    throw new Error(`no analysis.json in ${runDir}; run analyse first`);
  const problems = (
    JSON.parse(readFileSync(analysisPath, "utf8")) as {
      readonly problems: readonly AssessedProblem[];
    }
  ).problems;

  const key = loadAnswerKey(join(SCENARIOS_DIR, manifest.scenarioId));
  const deterministic = matchDeterministically(key, problems);
  const judged = await judgeUnresolvedMatches(models.judge, {
    key,
    proposals: problems,
    unresolvedKeyIds: deterministic.unresolvedKeyIds,
  });
  const recommendationVerdicts = await judgeRecommendations(models.judge, problems);

  const card = scoreCorpus({
    key,
    proposals: problems,
    matchVerdicts: [...deterministic.verdicts, ...judged],
    recommendationVerdicts,
  });

  writeFileSync(
    join(runDir, "scorecard.json"),
    JSON.stringify({ scorecard: card, judged, recommendationVerdicts }, null, 2),
  );

  const report = renderReport({
    runId: manifest.runId,
    scenarioTitle: manifest.scenarioTitle,
    modelIds: manifest.modelIds,
    sessionLines: manifest.sessions.map(
      (session) =>
        `${session.sessionId} (${session.personaId}): ${session.outcome} after ${String(session.steps.length)} steps — ${session.outcomeReason ?? "(no reason)"}`,
    ),
    problems,
    scorecard: card,
    exitReasonsShown: has("exit-reasons"),
  });

  writeFileSync(join(runDir, "report.md"), report);
  say(report);
}

const command = process.argv[2] ?? "all";

if (command === "record") {
  const runId = await record();
  say(`recorded run ${runId}`);
} else if (command === "corpus") {
  const runId = flag("run", null);
  if (runId === null) throw new Error("--run is required");
  buildCorpus(join(RUNS_DIR, runId), has("exit-reasons"));
} else if (command === "analyse") {
  const runId = flag("run", null);
  if (runId === null) throw new Error("--run is required");
  await analyse(join(RUNS_DIR, runId));
} else if (command === "score") {
  const runId = flag("run", null);
  if (runId === null) throw new Error("--run is required");
  await score(join(RUNS_DIR, runId));
} else if (command === "all") {
  const runId = await record();
  const runDir = join(RUNS_DIR, runId);
  await analyse(runDir);
  await score(runDir);
} else {
  throw new Error(`unknown command ${command}; expected record | corpus | analyse | score | all`);
}
