import { z } from "zod";

import { exclusionReasonSchema } from "../exclusions/types";
import { BUSINESS_FACT_LIMIT, businessFactKindSchema } from "../growth/business";

export const mcpIdSchema = z.string().min(1).max(128);

export const mcpTimestampSchema = z.iso.datetime();

export const mcpSetAsideBasisSchema = z.object({
  reason: exclusionReasonSchema,
  count: z.number().int().nonnegative(),

  label: z.string().min(1),
});
export type McpSetAsideBasis = z.infer<typeof mcpSetAsideBasisSchema>;

export const mcpCountBasisSchema = z.object({
  totalInWindow: z.number().int().nonnegative(),

  kept: z.number().int().nonnegative(),
  setAside: z.array(mcpSetAsideBasisSchema).readonly(),
});
export type McpCountBasis = z.infer<typeof mcpCountBasisSchema>;

export const mcpMeasuredCountSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    unit: z.literal("sessions"),
    timeframe: z.object({ start: mcpTimestampSchema, end: mcpTimestampSchema }),
    basis: mcpCountBasisSchema,
  })
  .superRefine((value, ctx) => {
    const setAsideTotal = value.basis.setAside.reduce((sum, row) => sum + row.count, 0);
    if (value.basis.kept + setAsideTotal !== value.basis.totalInWindow) {
      ctx.addIssue({
        code: "custom",
        path: ["basis"],
        message: `a basis must account for every session in the window: kept (${String(value.basis.kept)}) + set aside (${String(setAsideTotal)}) is not totalInWindow (${String(value.basis.totalInWindow)})`,
      });
    }

    if (value.denominator !== value.basis.kept) {
      ctx.addIssue({
        code: "custom",
        path: ["denominator"],
        message: `a denominator must be the basis's kept sessions: ${String(value.denominator)} is not ${String(value.basis.kept)}`,
      });
    }

    if (value.numerator > value.denominator) {
      ctx.addIssue({
        code: "custom",
        path: ["numerator"],
        message: `a numerator may never exceed its denominator: ${String(value.numerator)} of ${String(value.denominator)} is not a subset of the sessions measured`,
      });
    }

    if (Date.parse(value.timeframe.end) < Date.parse(value.timeframe.start)) {
      ctx.addIssue({
        code: "custom",
        path: ["timeframe"],
        message: "a timeframe must end no earlier than it starts",
      });
    }
  });
export type McpMeasuredCount = z.infer<typeof mcpMeasuredCountSchema>;

export const LIST_OPEN_FIXES_MAX_ITEMS = 25;

export const LIST_OPEN_FIXES_DEFAULT_ITEMS = LIST_OPEN_FIXES_MAX_ITEMS;

export const FINDING_EVIDENCE_MAX_ITEMS = 10;

export const FIX_ATTEMPT_CEILING = 3;

export const fixStatusSchema = z.enum(["open", "awaiting_verification", "verified", "withdrawn"]);
export type FixStatus = z.infer<typeof fixStatusSchema>;

export const findingEvidenceKindSchema = z.enum([
  "session_replay",

  "network_request",

  "funnel_step",

  "event",
]);
export type FindingEvidenceKind = z.infer<typeof findingEvidenceKindSchema>;

export const listOpenFixesInputSchema = z.object({
  projectId: mcpIdSchema.optional(),

  limit: z
    .number()
    .int()
    .min(1)
    .max(LIST_OPEN_FIXES_MAX_ITEMS)
    .default(LIST_OPEN_FIXES_DEFAULT_ITEMS),
});
export type ListOpenFixesInput = z.infer<typeof listOpenFixesInputSchema>;

export const getFixInputSchema = z.object({
  fixId: mcpIdSchema,
});
export type GetFixInput = z.infer<typeof getFixInputSchema>;

export const getFindingInputSchema = z.object({
  findingId: mcpIdSchema,
});
export type GetFindingInput = z.infer<typeof getFindingInputSchema>;

export const listWindowSchema = z
  .object({
    returned: z.number().int().nonnegative().max(LIST_OPEN_FIXES_MAX_ITEMS),

    totalOpen: z.number().int().nonnegative(),

    truncated: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.returned > value.totalOpen) {
      ctx.addIssue({
        code: "custom",
        path: ["returned"],
        message: `a response may not carry more entries than exist: ${String(value.returned)} of ${String(value.totalOpen)}`,
      });
    }

    if (value.truncated !== value.returned < value.totalOpen) {
      ctx.addIssue({
        code: "custom",
        path: ["truncated"],
        message: `truncated must state whether the list was cut short: ${String(value.returned)} of ${String(value.totalOpen)} returned, truncated was ${String(value.truncated)}`,
      });
    }
  });
export type ListWindow = z.infer<typeof listWindowSchema>;

export const openFixSummarySchema = z.object({
  fixId: mcpIdSchema,

  findingId: mcpIdSchema,

  summary: z.string().min(1),

  impact: mcpMeasuredCountSchema,
  openedAt: mcpTimestampSchema,

  resultsBy: mcpTimestampSchema,
  status: z.literal("open"),
});
export type OpenFixSummary = z.infer<typeof openFixSummarySchema>;

export const listOpenFixesOutputSchema = z
  .object({
    fixes: z.array(openFixSummarySchema).max(LIST_OPEN_FIXES_MAX_ITEMS).readonly(),
    window: listWindowSchema,
  })
  .superRefine((value, ctx) => {
    if (value.fixes.length !== value.window.returned) {
      ctx.addIssue({
        code: "custom",
        path: ["window", "returned"],
        message: `returned must count the entries actually sent: ${String(value.window.returned)} stated, ${String(value.fixes.length)} present`,
      });
    }
  });
export type ListOpenFixesOutput = z.infer<typeof listOpenFixesOutputSchema>;

export const fixSpecEnvelopeSchema = z
  .object({
    fixId: mcpIdSchema,
    findingId: mcpIdSchema,
    status: fixStatusSchema,

    specText: z.string().min(1),

    attempt: z.number().int().min(1).max(FIX_ATTEMPT_CEILING),

    attemptsAllowed: z.literal(FIX_ATTEMPT_CEILING),

    alreadyLanded: z.array(z.string().min(1)).max(FIX_ATTEMPT_CEILING).readonly(),

    impact: mcpMeasuredCountSchema,

    resultsBy: mcpTimestampSchema,

    dateIsFinal: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (value.attempt === 1 && value.alreadyLanded.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["alreadyLanded"],
        message: "a first attempt cannot have earlier work to narrow around",
      });
    }
  });
export type FixSpecEnvelope = z.infer<typeof fixSpecEnvelopeSchema>;

export const findingEvidenceSchema = z.object({
  kind: findingEvidenceKindSchema,

  label: z.string().min(1),

  url: z.url().nullable(),
});
export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;

export const getFindingOutputSchema = z.object({
  findingId: mcpIdSchema,

  fixId: mcpIdSchema.nullable(),

  headline: z.string().min(1),

  detail: z.string().min(1),
  surface: z.object({
    name: z.string().min(1),

    path: z.string().min(1).nullable(),
  }),

  affected: mcpMeasuredCountSchema,
  firstSeenAt: mcpTimestampSchema,
  lastSeenAt: mcpTimestampSchema,
  evidence: z.array(findingEvidenceSchema).min(1).max(FINDING_EVIDENCE_MAX_ITEMS).readonly(),
});
export type GetFindingOutput = z.infer<typeof getFindingOutputSchema>;

export const GROWTH_CONTEXT_MAX_ITEMS = 10;

export const getGrowthContextInputSchema = z.object({
  surface: z.string().min(1).max(512).optional(),

  projectId: mcpIdSchema.optional(),
});
export type GetGrowthContextInput = z.infer<typeof getGrowthContextInputSchema>;

export const surfaceNoteSchema = z.object({
  surface: z.string().min(1),

  matters: z.string().min(1),

  confirmedByAPerson: z.boolean(),
});
export type SurfaceNote = z.infer<typeof surfaceNoteSchema>;

export const changeableSchema = z.object({
  allowed: z.boolean(),

  reason: z.string().min(1).nullable(),
});
export type Changeable = z.infer<typeof changeableSchema>;

export const knownProblemSchema = z.object({
  findingId: mcpIdSchema,

  fixId: mcpIdSchema.nullable(),
  headline: z.string().min(1),
  affected: mcpMeasuredCountSchema,
  lastSeenAt: mcpTimestampSchema,
});
export type KnownProblem = z.infer<typeof knownProblemSchema>;

export const declinedIdeaSchema = z.object({
  headline: z.string().min(1),
  declinedAt: mcpTimestampSchema,
});
export type DeclinedIdea = z.infer<typeof declinedIdeaSchema>;

export const businessFactSchema = z.object({
  about: businessFactKindSchema,

  // The same sentence the person who owns this business reads on their settings page, per
  // §10's one-output-two-audiences rule.
  heading: z.string().min(1),

  // What to do with it. An agent handed "regime: UK Gambling Commission" and nothing else
  // has no way to know it must not ship the change it was about to.
  means: z.string().min(1),

  statement: z.string().min(1),

  // A fact that can stop a change shipping, as against one that only shapes how it is
  // built. An agent that cannot tell them apart treats a licence like a preference.
  binding: z.boolean(),

  // Where it came from, so an agent can weigh it. "the people who run this product"
  // outranks a page we read.
  toldToUs: z.boolean(),

  readFrom: z.string().nullable(),

  // A website says what a business claims; only sessions say what people did. An agent that
  // cannot tell the two apart builds for the marketing copy.
  observed: z.boolean(),

  seenIn: z.string().nullable(),
});
export type McpBusinessFact = z.infer<typeof businessFactSchema>;

export const getGrowthContextOutputSchema = z
  .object({
    projectId: mcpIdSchema,

    surface: z.string().min(1).nullable(),

    changeable: changeableSchema.nullable(),

    whatMatters: z.array(surfaceNoteSchema).max(GROWTH_CONTEXT_MAX_ITEMS).readonly(),

    knownProblems: z.array(knownProblemSchema).max(GROWTH_CONTEXT_MAX_ITEMS).readonly(),

    declined: z.array(declinedIdeaSchema).max(GROWTH_CONTEXT_MAX_ITEMS).readonly(),

    // What binds this business and how its product is used. Not capped at the same ten as
    // the lists above: a constraint that fell off the end of a list is a constraint nothing
    // enforces.
    business: z.array(businessFactSchema).max(BUSINESS_FACT_LIMIT).readonly(),

    nothingKnownYet: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.surface === null && value.changeable !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["changeable"],
        message: "a changeable verdict answers one page, so it needs one page to have been named",
      });
    }

    if (value.surface !== null && value.changeable === null) {
      ctx.addIssue({
        code: "custom",
        path: ["changeable"],
        message: "a named page must carry whether it may be changed",
      });
    }

    const known =
      value.whatMatters.length > 0 ||
      value.knownProblems.length > 0 ||
      value.declined.length > 0 ||
      value.business.length > 0;
    if (value.nothingKnownYet && known) {
      ctx.addIssue({
        code: "custom",
        path: ["nothingKnownYet"],
        message: "nothingKnownYet may not be true alongside something known",
      });
    }
  });
export type GetGrowthContextOutput = z.infer<typeof getGrowthContextOutputSchema>;
