import {
  EVIDENCE_CLAIM_DROPPED,
  FINDING_BLOCK_ID_PREFIX,
  GET_IT_FIXED_ACTION_ID,
  GET_IT_FIXED_LABEL,
  NOT_USEFUL_ACTION_ID,
  NOT_USEFUL_LABEL,
  RENDERED_MESSAGE_VERSION,
  SUMMARY_SOURCE_MESSAGES,
  nothingTodayReasonSchema,
  renderedMessageSchema,
} from "@growthmind/shared";
import type { NothingTodayReason, RenderedMessage } from "@growthmind/shared";
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

// A citation link, pre-built by the caller exactly as apps/web/lib/findings/evidence.ts
// builds ClaimView.citesHref — never constructed here from raw ids.
export type DeliveredCauseClaim = {
  readonly statement: string;
  readonly citesHref: string | null;
  readonly citesLabel: string;
};

// "explained" only when at least one claim survived the citation gate; "described" is the
// arm that carries the honesty line when the cause stage attempted the finding and the gate
// emptied every claim (droppedClaims > 0) — a finding with no cause_claims row at all never
// reaches this type, its DeliveredExplanation simply omits `cause`.
export type DeliveredCause =
  | {
      readonly grade: "explained";
      readonly claims: readonly DeliveredCauseClaim[];
      readonly droppedClaims: number;
    }
  | {
      readonly grade: "described";
      readonly claims: readonly DeliveredCauseClaim[];
      readonly droppedClaims: number;
    };

export type DeliveredExplanation =
  | {
      readonly source: "model_rendered";
      readonly headline: string;
      readonly context: string;

      // Optional and additive (ADD-044): a finding whose cause stage never ran, or never
      // produced a cause_claims row, carries no `cause` at all — rendering is byte-identical
      // to before this field existed.
      readonly cause?: DeliveredCause;
    }
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

const deliveredCauseClaimSchema = z.object({
  statement: z.string().min(1),
  citesHref: z.string().min(1).nullable(),
  citesLabel: z.string().min(1),
});

export const deliveredCauseSchema = z.discriminatedUnion("grade", [
  z.object({
    grade: z.literal("explained"),
    claims: z.array(deliveredCauseClaimSchema).min(1),
    droppedClaims: z.number().int().nonnegative(),
  }),
  z.object({
    grade: z.literal("described"),
    claims: z.array(deliveredCauseClaimSchema).length(0),
    droppedClaims: z.number().int().positive(),
  }),
]);

export const deliveredExplanationSchema = z.union([
  z.object({
    source: z.literal("model_rendered"),
    headline: z.string().min(1),
    context: z.string().min(1),
    cause: deliveredCauseSchema.optional(),
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
  readonly cause: string | null;
  readonly basis: string | null;
  readonly window: string | null;
};

// citesHref is null only when D5 degraded it upstream (mask/withheld) — the same fallback
// apps/web's own citation control renders, never a dead link.
function claimLine(claim: DeliveredCauseClaim): string {
  const cite =
    claim.citesHref === null ? claim.citesLabel : `<${claim.citesHref}|${claim.citesLabel}>`;
  return `${withoutTrailingStop(claim.statement)} (${cite}).`;
}

// The honesty line is the whole rendering for a "described, attempted" cause — never a
// fabricated citation for a claim the gate actually dropped (D10).
function causeTextOf(cause: DeliveredCause | undefined): string | null {
  if (cause === undefined) return null;

  if (cause.grade === "described") {
    return cause.droppedClaims > 0 ? EVIDENCE_CLAIM_DROPPED : null;
  }

  const bullet = cause.claims.length > 1 ? "• " : "";
  const lines = cause.claims.map((claim) => `${bullet}${claimLine(claim)}`);
  if (cause.droppedClaims > 0) {
    lines.push(EVIDENCE_CLAIM_DROPPED);
  }
  return lines.join("\n");
}

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

  if (parts.cause !== null) {
    blocks.push({ kind: "section", text: parts.cause });
  }

  const footer = [parts.basis, parts.window].filter((line): line is string => line !== null);
  if (footer.length > 0) {
    blocks.push({ kind: "context", text: footer.join("\n") });
  }

  return blocks;
}

const MRKDWN_LINK_PATTERN = /<([^|>]+)\|([^>]+)>/g;

function plainTextOf(blocks: readonly SlackTextBlock[]): string {
  return blocks
    .map((block) => block.text)
    .join("\n")
    .replaceAll(MRKDWN_LINK_PATTERN, "$2")
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
      {
        actionId: NOT_USEFUL_ACTION_ID,
        label: NOT_USEFUL_LABEL,
        value: findingId,
        style: null,
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
    cause: explanation.source === "model_rendered" ? causeTextOf(explanation.cause) : null,
    basis: firstCount ? renderBasisLine(firstCount) : null,
    window: firstCount ? renderWindowLine(firstCount) : null,
  };

  // The causal clause is the "why", the same weight as `explanation` — it degrades in step
  // with it (shortened together) and is dropped one rung later, still ahead of the basis/
  // window footer.
  const ladder: readonly MessageParts[] = [
    parts,
    { ...parts, explanation: shortened(parts.explanation) },
    { ...parts, explanation: shortened(parts.explanation), cause: null },
    { ...parts, explanation: shortened(parts.explanation), cause: null, basis: null },
    { ...parts, explanation: shortened(parts.explanation), cause: null, basis: null, window: null },
    { ...parts, explanation: null, cause: null, basis: null, window: null },
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

// The second frame of "one renderer, one render, two frames": the same `SlackMessage` that
// `toBlockKit` turns into Slack's wire format, in a shape a reader other than Slack can be
// handed. Parsed on the way out so a shape that could not be read back is never persisted.
export function renderedMessageOf(message: SlackMessage): RenderedMessage {
  return renderedMessageSchema.parse({
    version: RENDERED_MESSAGE_VERSION,
    blocks: message.blocks,
    text: message.text,
    legibility: message.legibility,
  });
}
