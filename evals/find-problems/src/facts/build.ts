import type { CorpusAnalysisInput, SessionSummary } from "../analyse/types";
import { ACTIVATION_DEFINITION, hasConnectedSomething } from "./activation";
import type { CorpusFact, CorpusFacts } from "./types";

const OUTCOME_PHRASES: Readonly<Record<SessionSummary["outcome"], string>> = {
  completed: "reached what they came to do",
  gave_up: "gave up and left",
  step_cap: "ran out of attempts without reaching an outcome",
  driver_error: "ended in a recording failure",
};

const OUTCOME_ORDER: readonly SessionSummary["outcome"][] = [
  "completed",
  "gave_up",
  "step_cap",
  "driver_error",
];

/** The transcript's own form for what the screen said back; see render.ts in packages/core. */
const REACTION_LINE = /(?:^|\s)saw (.+)$/;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The product's pages by path, another company's by origin alone: the rest of an OAuth URL is
 * one-time state, and naming it would put a signed token in front of the analyser.
 */
export function pageLabel(url: string, productOrigin: string | null): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  return parsed.origin === productOrigin ? parsed.pathname : parsed.origin;
}

function fact(
  id: string,
  statement: (count: number, of: number) => string,
  sessions: readonly SessionSummary[],
  of: number,
  subjectSignals: readonly string[],
): CorpusFact {
  const sessionIds = sessions.map((session) => session.sessionId);
  return {
    id,
    statement: statement(sessionIds.length, of),
    count: sessionIds.length,
    of,
    sessionIds,
    subjectSignals,
  };
}

function reachFacts(
  input: CorpusAnalysisInput,
  productOrigin: string | null,
): readonly CorpusFact[] {
  const order: string[] = [];
  const reached = new Map<string, SessionSummary[]>();

  for (const session of input.sessions) {
    const labels = new Set(session.urlTrail.map((url) => pageLabel(url, productOrigin)));
    for (const label of labels) {
      const existing = reached.get(label);
      if (existing === undefined) {
        order.push(label);
        reached.set(label, [session]);
        continue;
      }
      existing.push(session);
    }
  }

  return order
    .map((label) =>
      fact(
        `reached:${label}`,
        (count, of) => `${String(count)} of ${String(of)} sessions reached ${label}`,
        reached.get(label) ?? [],
        input.sessionsTotal,
        [`reached ${label}`, `reach ${label}`],
      ),
    )
    .toSorted((left, right) => right.count - left.count);
}

function saidBackFacts(input: CorpusAnalysisInput): readonly CorpusFact[] {
  const order: string[] = [];
  const shown = new Map<string, SessionSummary[]>();

  for (const session of input.sessions) {
    const said = new Set<string>();
    for (const beat of session.beats) {
      const match = REACTION_LINE.exec(beat.line);
      if (match?.[1] !== undefined) said.add(match[1].trim());
    }
    for (const words of said) {
      const existing = shown.get(words);
      if (existing === undefined) {
        order.push(words);
        shown.set(words, [session]);
        continue;
      }
      existing.push(session);
    }
  }

  return order
    .map((words) =>
      fact(
        `said:${words}`,
        (count, of) => `${String(count)} of ${String(of)} sessions were shown ${words}`,
        shown.get(words) ?? [],
        input.sessionsTotal,
        [`shown ${words}`, `saw ${words}`],
      ),
    )
    .toSorted((left, right) => right.count - left.count);
}

/**
 * Every count this harness reports, computed from the corpus alone. The analyser is told these
 * rather than asked for them: a funnel is arithmetic, and arithmetic is not a judgement call.
 */
export function buildCorpusFacts(input: CorpusAnalysisInput): CorpusFacts {
  const of = input.sessionsTotal;
  const productOrigin = originOf(input.startUrl);

  const headline = fact(
    "connected",
    (count, total) => `${String(count)} of ${String(total)} sessions connected anything`,
    input.sessions.filter(hasConnectedSomething),
    of,
    ["connected anything", "connected nothing", "sessions connected", "session connected"],
  );

  const outcomes = OUTCOME_ORDER.flatMap((outcome) => {
    const matching = input.sessions.filter((session) => session.outcome === outcome);
    if (matching.length === 0) return [];
    return [
      fact(
        `outcome:${outcome}`,
        (count, total) =>
          `${String(count)} of ${String(total)} sessions ${OUTCOME_PHRASES[outcome]}`,
        matching,
        of,
        [OUTCOME_PHRASES[outcome]],
      ),
    ];
  });

  const leftForGood = fact(
    "left-the-product",
    (count, total) =>
      `${String(count)} of ${String(total)} sessions left the product for another site and did not come back`,
    input.sessions.filter((session) => {
      const last = session.urlTrail.at(-1);
      return last !== undefined && originOf(last) !== productOrigin;
    }),
    of,
    ["left the product for another site", "did not come back"],
  );

  const oneScreen = fact(
    "one-page-only",
    (count, total) =>
      `${String(count)} of ${String(total)} sessions saw one page of the product and no more`,
    input.sessions.filter(
      (session) => new Set(session.urlTrail.map((url) => pageLabel(url, productOrigin))).size === 1,
    ),
    of,
    ["one page of the product", "saw only one page"],
  );

  const browserErrors = fact(
    "browser-errors",
    (count, total) =>
      `${String(count)} of ${String(total)} sessions recorded a browser error on the product's own pages`,
    input.sessions.filter((session) => session.consoleErrorCount > 0),
    of,
    ["recorded a browser error", "browser error on the product"],
  );

  return {
    definitionOfActivation: ACTIVATION_DEFINITION,
    headline,
    facts: [
      headline,
      ...outcomes,
      ...reachFacts(input, productOrigin),
      leftForGood,
      oneScreen,
      ...saidBackFacts(input),
      browserErrors,
    ],
  };
}

export function factLine(entry: CorpusFact): string {
  const ids = entry.sessionIds.length === 0 ? "no sessions" : entry.sessionIds.join(", ");
  return `${entry.statement} (${ids})`;
}
