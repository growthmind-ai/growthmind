export const FIRST_RUN_API = {
  status: "/api/first-run/status",
  arm: "/api/first-run/arm",
  dismiss: "/api/first-run/dismiss",
  analyticsConnect: "/api/first-run/analytics/connect",
  analyticsDisconnect: "/api/first-run/analytics/disconnect",
  slackConnect: "/api/first-run/slack/connect",
  slackTest: "/api/first-run/slack/test",
  slackSkip: "/api/first-run/slack/skip",
} as const;

export interface PostAnswer {
  readonly ok: boolean;
  readonly body: unknown;
}

export interface ResponseRefusal {
  readonly code: string | null;

  readonly message: string;
}

export interface TestPostAnswer {
  readonly ok: boolean;
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export async function postJson(path: string, body: unknown): Promise<PostAnswer | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return { ok: response.ok, body: (await response.json()) as unknown };
  } catch {
    return null;
  }
}

export function readRefusal(body: unknown): ResponseRefusal | null {
  const record = asRecord(body);
  if (record === null) return null;

  const nested = asRecord(record.refusal) ?? asRecord(record.error);
  if (nested === null) return null;

  const message = nested.message;
  if (typeof message !== "string") return null;

  return { code: typeof nested.code === "string" ? nested.code : null, message };
}

export function readTestPostAnswer(body: unknown): TestPostAnswer | null {
  const record = asRecord(body);
  if (record === null) return null;

  const sentence = record.sentence;
  if (typeof sentence !== "string") return null;

  return {
    ok: record.ok === true,
    sentence,
    retryable: record.retryable === true,
    marksStepDone: record.marksStepDone === true,
  };
}
