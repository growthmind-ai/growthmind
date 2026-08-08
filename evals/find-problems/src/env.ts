import { DEFAULT_COLDSTART_MODEL } from "@growthmind/adapters";

// Verified reachable with the Bedrock key in .env at AWS_REGION=eu-west-2. The `eu.` prefix is
// load-bearing for the same reason it is in packages/adapters/src/model/constants.ts.
export const DEFAULT_ANALYSER_MODEL = "eu.anthropic.claude-sonnet-4-5-20250929-v1:0";

export class MissingCredentialError extends Error {
  constructor(variable: string) {
    super(
      [
        `${variable} is not set, so no model call can be made.`,
        "bun reads .env from the current working directory, not the repo root:",
        "run this from the repo root (bun evals/find-problems/src/run.ts) or pass --env-file.",
      ].join(" "),
    );
    this.name = "MissingCredentialError";
  }
}

export interface EvalEnv {
  readonly apiKey: string;
  readonly region: string;

  /** Personas decide their own next click; a small model is enough and there are many calls. */
  readonly personaModelId: string;

  /** Corpus analysis is the thing under test, so it gets its own id to raise. */
  readonly analyserModelId: string;

  readonly judgeModelId: string;
}

function required(variable: string): string {
  const value = process.env[variable];
  if (value === undefined || value.trim().length === 0) {
    throw new MissingCredentialError(variable);
  }
  return value;
}

export function readEvalEnv(): EvalEnv {
  return {
    apiKey: required("AWS_BEARER_TOKEN_BEDROCK"),
    region: process.env["AWS_REGION"] ?? "eu-west-2",
    personaModelId: process.env["EVAL_PERSONA_MODEL"] ?? DEFAULT_COLDSTART_MODEL,
    analyserModelId: process.env["EVAL_ANALYSER_MODEL"] ?? DEFAULT_ANALYSER_MODEL,
    judgeModelId: process.env["EVAL_JUDGE_MODEL"] ?? DEFAULT_ANALYSER_MODEL,
  };
}
