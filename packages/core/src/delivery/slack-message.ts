import {
  FINDING_BLOCK_ID_PREFIX,
  GET_IT_FIXED_ACTION_ID,
  GET_IT_FIXED_LABEL,
  SUMMARY_SOURCE_MESSAGES,
  nothingTodayReasonSchema,
} from "@growthmind/shared";
import type { NothingTodayReason } from "@growthmind/shared";
import { z } from "zod";

import { measuredCountSchema, rateOf } from "../counts/measured-count";
import type { MeasuredCount } from "../counts/measured-count";

import { floorSummarySourceSchema } from "../summary/types";
import type { FloorSummarySource } from "../summary/types";

export const SLACK_MESSAGE_CHARACTER_BUDGET = 900;

export const SLACK_MESSAGE_LINE_BUDGET = 12;

export const SURFACE_PATH_BUDGET = 48;

export const HEADLINE_BUDGET = 100;

export const CONTEXT_BUDGET = 280;

export const TIGHT_CONTEXT_BUDGET = 140;

export const OBSERVATION_LABEL_BUDGET = 90;

export const MAX_OBSERVATIONS = 3;

export const TRUNCATION_MARKER = "…";

export const COHORT_NOUNS = [
  "people",
  "person",
  "persons",
  "user",
  "users",
  "customer",
  "customers",
  "visitor",
  "visitors",
  "human",
  "humans",
  "folks",
] as const;

const COHORT_NOUN_PATTERN = new RegExp(`\\b(?:${COHORT_NOUNS.join("|")})\\b`, "i");

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type DeliveryVocabulary = {
  readonly nothingTodayLead: string;
  readonly nothingToday: Readonly<Record<NothingTodayReason, string>>;
  readonly noRate: string;
};

export type Observation = {
  readonly label: string;
  readonly count: MeasuredCount;
};

export type DeliveredExplanation =
  | { readonly source: "model_rendered"; readonly headline: string; readonly context: string }
  | { readonly source: FloorSummarySource };

export type SlackMessageInput =
  | {
      readonly decision: "deliver";

      readonly surfacePath: string;
      readonly observations: readonly Observation[];
      readonly explanation: DeliveredExplanation;

      readonly findingId?: string;
    }
  | {
      readonly decision: "nothing_today";
      readonly reason: NothingTodayReason;
    };

export type SlackAction = {
  readonly actionId: string;
  readonly label: string;
  readonly value: string;
  readonly style: "primary" | null;
};

export type SlackTextBlock =
  | { readonly kind: "section"; readonly text: string }
  | { readonly kind: "context"; readonly text: string };

export type SlackActionsBlock = {
  readonly kind: "actions";
  readonly blockId: string;
  readonly actions: readonly SlackAction[];
};

export type SlackBlock = SlackTextBlock | SlackActionsBlock;

export type SlackMessage = {
  readonly blocks: readonly SlackBlock[];

  readonly text: string;

  readonly legibility: { readonly characters: number; readonly lines: number };
};

export const observationSchema = z.object({
  label: z
    .string()
    .min(1)
    .refine((label) => !describesPeople(label), {
      message: "an observation label may not describe sessions as people",
    }),
  count: measuredCountSchema,
});

export const deliveredExplanationSchema = z.union([
  z.object({
    source: z.literal("model_rendered"),
    headline: z.string().min(1),
    context: z.string().min(1),
  }),
  z.object({ source: floorSummarySourceSchema }),
]);

const deliverInputSchema = z
  .object({
    decision: z.literal("deliver"),
    surfacePath: z.string().min(1),
    observations: z.array(observationSchema).min(1).max(MAX_OBSERVATIONS),
    explanation: deliveredExplanationSchema,
    findingId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const [first, ...rest] = value.observations;
    if (!first) return;

    for (const observation of rest) {
      const sameWindow =
        observation.count.timeframe.start.getTime() === first.count.timeframe.start.getTime() &&
        observation.count.timeframe.end.getTime() === first.count.timeframe.end.getTime();
      const sameBasis =
        observation.count.denominator === first.count.denominator &&
        observation.count.basis.totalInWindow === first.count.basis.totalInWindow;

      if (!sameWindow || !sameBasis) {
        ctx.addIssue({
          code: "custom",
          path: ["observations"],
          message:
            "every count in one message must be measured over the same window and the same basis",
        });
        return;
      }
    }
  });

export const slackMessageInputSchema = z.union([
  deliverInputSchema,
  z.object({ decision: z.literal("nothing_today"), reason: nothingTodayReasonSchema }),
]);

export function describesPeople(text: string): boolean {
  return COHORT_NOUN_PATTERN.test(text);
}

function truncateEnd(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(0, budget - TRUNCATION_MARKER.length)).trimEnd()}${TRUNCATION_MARKER}`;
}

function truncateMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const usable = Math.max(0, budget - TRUNCATION_MARKER.length);
  const head = Math.ceil(usable / 2);
  const tail = usable - head;
  return `${text.slice(0, head)}${TRUNCATION_MARKER}${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

function withoutTrailingStop(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function describeShare(count: MeasuredCount, value: number): string {
  const percent = Math.round(value * 100);

  if (count.numerator > 0 && percent === 0) return "under 1%";
  if (count.numerator < count.denominator && percent === 100) return "over 99%";
  return `${percent}%`;
}

export function renderCountSentence(
  observation: Observation,
  vocabulary: DeliveryVocabulary,
): string {
  const rate = rateOf(observation.count);
  if (rate.kind === "no_rate") return vocabulary.noRate;

  const label = truncateEnd(withoutTrailingStop(observation.label), OBSERVATION_LABEL_BUDGET);
  const { numerator, denominator, unit } = observation.count;

  return `${numerator} of ${denominator} ${unit} ${label} (${describeShare(observation.count, rate.value)}).`;
}

function renderDate(instant: Date): string {
  return `${instant.getUTCDate()} ${MONTHS[instant.getUTCMonth()]} ${instant.getUTCFullYear()}`;
}

function renderWindowLine(count: MeasuredCount): string {
  return `Sessions from ${renderDate(count.timeframe.start)} to ${renderDate(count.timeframe.end)}.`;
}

function renderBasisLine(count: MeasuredCount): string {
  const { basis } = count;
  const setAside = basis.setAside.filter((row) => row.count > 0);

  if (setAside.length === 0) {
    return `Counted all ${basis.totalInWindow} sessions we looked at.`;
  }

  const breakdown = setAside.map((row) => `${row.count} ${row.label.toLowerCase()}`).join(", ");
  const setAsideTotal = setAside.reduce((sum, row) => sum + row.count, 0);

  return `Counted ${basis.kept} of the ${basis.totalInWindow} sessions we looked at. ${setAsideTotal} set aside: ${breakdown}.`;
}

type MessageParts = {
  readonly heading: string;
  readonly headline: string | null;
  readonly observations: readonly string[];
  readonly explanation: string | null;
  readonly basis: string | null;
  readonly window: string | null;
};

function blocksOf(parts: MessageParts): SlackTextBlock[] {
  const lead = parts.headline === null ? parts.heading : `${parts.heading}\n${parts.headline}`;
  const blocks: SlackTextBlock[] = [{ kind: "section", text: lead }];

  const bullet = parts.observations.length > 1 ? "• " : "";
  blocks.push({
    kind: "section",
    text: parts.observations.map((sentence) => `${bullet}${sentence}`).join("\n"),
  });

  if (parts.explanation !== null) {
    blocks.push({ kind: "section", text: parts.explanation });
  }

  const footer = [parts.basis, parts.window].filter((line): line is string => line !== null);
  if (footer.length > 0) {
    blocks.push({ kind: "context", text: footer.join("\n") });
  }

  return blocks;
}

function plainTextOf(blocks: readonly SlackTextBlock[]): string {
  return blocks
    .map((block) => block.text)
    .join("\n")
    .replaceAll("*", "");
}

function fits(blocks: readonly SlackTextBlock[]): boolean {
  const text = plainTextOf(blocks);
  return (
    text.length <= SLACK_MESSAGE_CHARACTER_BUDGET &&
    text.split("\n").length <= SLACK_MESSAGE_LINE_BUDGET
  );
}

function clampToBudget(blocks: readonly SlackTextBlock[]): SlackTextBlock[] {
  const kept: SlackTextBlock[] = [...blocks];

  while (kept.length > 1 && !fits(kept)) {
    kept.pop();
  }

  const last = kept[kept.length - 1];
  if (last && !fits(kept)) {
    const others = kept.slice(0, -1);
    const overheadCharacters = others.length === 0 ? 0 : plainTextOf(others).length + 1;
    const remaining = Math.max(0, SLACK_MESSAGE_CHARACTER_BUDGET - overheadCharacters);
    kept[kept.length - 1] = { kind: last.kind, text: truncateEnd(last.text, remaining) };
  }

  return kept;
}

// The actions block joins after the budget has been settled: a button carries no sentence a
// reader has to get through, so counting it would cost the message a line of explanation.
function messageOf(
  blocks: readonly SlackTextBlock[],
  actions: SlackActionsBlock | null,
): SlackMessage {
  const text = plainTextOf(blocks);
  return {
    blocks: actions === null ? blocks : [...blocks, actions],
    text,
    legibility: { characters: text.length, lines: text.split("\n").length },
  };
}

function actionsFor(findingId: string | undefined): SlackActionsBlock | null {
  if (findingId === undefined) return null;

  return {
    kind: "actions",
    blockId: `${FINDING_BLOCK_ID_PREFIX}${findingId}`,
    actions: [
      {
        actionId: GET_IT_FIXED_ACTION_ID,
        label: GET_IT_FIXED_LABEL,
        value: findingId,
        style: "primary",
      },
    ],
  };
}

export function renderSlackMessage(
  input: SlackMessageInput,
  vocabulary: DeliveryVocabulary,
): SlackMessage {
  slackMessageInputSchema.parse(input);

  if (input.decision === "nothing_today") {
    return messageOf(
      [
        {
          kind: "section",
          text: `${vocabulary.nothingTodayLead}\n${vocabulary.nothingToday[input.reason]}`,
        },
      ],
      null,
    );
  }

  const actions = actionsFor(input.findingId);

  const explanation: DeliveredExplanation =
    input.explanation.source === "model_rendered" &&
    (describesPeople(input.explanation.headline) || describesPeople(input.explanation.context))
      ? { source: "floor_model_text_rejected" }
      : input.explanation;

  const firstCount = input.observations[0]?.count;

  const parts: MessageParts = {
    heading: `*${truncateMiddle(input.surfacePath, SURFACE_PATH_BUDGET)}*`,
    headline:
      explanation.source === "model_rendered"
        ? truncateEnd(explanation.headline, HEADLINE_BUDGET)
        : null,
    observations: input.observations.map((observation) =>
      renderCountSentence(observation, vocabulary),
    ),

    explanation:
      explanation.source === "model_rendered"
        ? truncateEnd(explanation.context, CONTEXT_BUDGET)
        : SUMMARY_SOURCE_MESSAGES[explanation.source],
    basis: firstCount ? renderBasisLine(firstCount) : null,
    window: firstCount ? renderWindowLine(firstCount) : null,
  };

  const ladder: readonly MessageParts[] = [
    parts,
    { ...parts, explanation: shortened(parts.explanation) },
    { ...parts, explanation: shortened(parts.explanation), basis: null },
    { ...parts, explanation: shortened(parts.explanation), basis: null, window: null },
    { ...parts, explanation: null, basis: null, window: null },
  ];

  for (const rung of ladder) {
    const blocks = blocksOf(rung);
    if (fits(blocks)) return messageOf(blocks, actions);
  }

  const last = ladder[ladder.length - 1] ?? parts;
  return messageOf(clampToBudget(blocksOf(last)), actions);
}

function shortened(explanation: string | null): string | null {
  return explanation === null ? null : truncateEnd(explanation, TIGHT_CONTEXT_BUDGET);
}
