import { statedOutOf } from "./analyse/support";
import type { AssessedProblem } from "./analyse/types";
import type { Scorecard } from "./score/types";

function bullet(lines: readonly string[]): string {
  return lines.length === 0 ? "- (none)" : lines.map((line) => `- ${line}`).join("\n");
}

export function renderProblems(problems: readonly AssessedProblem[]): string {
  if (problems.length === 0) return "The analyser proposed nothing.";

  return problems
    .map((problem) =>
      [
        `### ${problem.id}. ${problem.title}`,
        "",
        `**Seen in ${statedOutOf(problem)}.** Support: ${problem.support} (${String(problem.validCitations)} checkable citations, ${String(problem.invalidCitations)} pointing at nothing).`,
        "",
        problem.whatWasSeen,
        "",
        `**Do this:** ${problem.recommendation.action} — on ${problem.recommendation.whereInProduct}. ${problem.recommendation.whyItHelps}`,
        "",
        "Citations:",
        bullet(
          problem.citations.map(
            (citation) => `${citation.sessionId} beat ${String(citation.beat)}: ${citation.quote}`,
          ),
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

export interface ReportInput {
  readonly runId: string;
  readonly scenarioTitle: string;
  readonly modelIds: Readonly<Record<string, string>>;
  readonly sessionLines: readonly string[];
  readonly problems: readonly AssessedProblem[];
  readonly scorecard: Scorecard;
  readonly exitReasonsShown: boolean;
}

export function renderReport(input: ReportInput): string {
  const card = input.scorecard;

  return [
    `# ${input.scenarioTitle}`,
    "",
    `Run \`${input.runId}\`. Persona model \`${input.modelIds["persona"] ?? "?"}\`, analyser \`${input.modelIds["analyser"] ?? "?"}\`, judge \`${input.modelIds["judge"] ?? "?"}\`.`,
    `Exit reasons ${input.exitReasonsShown ? "were" : "were not"} shown to the analyser.`,
    "",
    "## Sessions recorded",
    "",
    bullet(input.sessionLines),
    "",
    "## What the analyser proposed",
    "",
    renderProblems(input.problems),
    "",
    "## Scorecard",
    "",
    `- Planted problems found: ${String(card.found.length)} of ${String(card.keyTotal)} (${String(card.rowsMatched)} by string match, ${String(card.rowsJudged)} by model judge)`,
    `- Planted problems missed: ${String(card.missed.length)} of ${String(card.keyTotal)}`,
    `- Proposals made: ${String(card.proposalsTotal)}`,
    `- Proposals with no planted problem and no checkable citation (invented): ${String(card.invented.length)} of ${String(card.proposalsTotal)}`,
    `- Proposals beyond the key but citing real beats: ${String(card.beyondTheKey.length)} of ${String(card.proposalsTotal)}`,
    `- Claims marked unsupported: ${String(card.unsupportedClaims.length)} of ${String(card.proposalsTotal)}`,
    `- Claims counting more sessions than the corpus holds: ${String(card.claimsOverstatingTheCorpus.length)} of ${String(card.proposalsTotal)}`,
    `- Recommendations judged actionable: ${String(card.actionableRecommendations)} of ${String(card.recommendationsJudged)} judged`,
    "",
    "### Found",
    "",
    bullet(
      card.found.map(
        (row) => `${row.keyProblemId} ${row.keyTitle} → ${row.proposalId} (${row.method})`,
      ),
    ),
    "",
    "### Missed",
    "",
    bullet(card.missed.map((row) => `${row.keyProblemId} ${row.keyTitle} (${row.severity})`)),
    "",
    "### Invented",
    "",
    bullet(
      card.invented.map((row) => `${row.proposalId} ${row.title} — claimed ${row.statedOutOf}`),
    ),
  ].join("\n");
}
