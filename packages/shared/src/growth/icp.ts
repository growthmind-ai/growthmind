import { z } from "zod";

export const ICP_BELIEF_KINDS = [
  "who_it_is_for",
  "what_they_believe",
  "what_they_are_trying_to_do",
] as const;

export type IcpBeliefKind = (typeof ICP_BELIEF_KINDS)[number];

export const icpBeliefKindSchema = z.enum(ICP_BELIEF_KINDS);

export const ICP_SOURCES = ["site", "sessions", "stated_by_customer"] as const;

export type IcpSource = (typeof ICP_SOURCES)[number];

export const icpSourceSchema = z.enum(ICP_SOURCES);

export const ICP_BELIEF_LIMIT = 24;

export const ICP_STATEMENT_MAX = 400;

// Where the claim came from and when. O-036: a claim without this is a guess wearing a
// schema, and §6 applies to us before it applies to a customer.
export const icpProvenanceSchema = z.object({
  source: icpSourceSchema,

  at: z.coerce.date(),

  // The page this was read from. Null for anything not read off the site.
  citation: z.string().max(2048).nullable(),
});

export type IcpProvenance = z.infer<typeof icpProvenanceSchema>;

export const icpBeliefSchema = z.object({
  kind: icpBeliefKindSchema,

  statement: z.string().min(1).max(ICP_STATEMENT_MAX),

  provenance: icpProvenanceSchema,

  // What we had said before a person corrected it. A correction is the highest-signal row
  // in the table, so it keeps what it replaced rather than overwriting it into silence.
  correctedFrom: z.string().max(ICP_STATEMENT_MAX).nullable(),
});

export type IcpBelief = z.infer<typeof icpBeliefSchema>;

export const icpModelSchema = z.object({
  beliefs: z.array(icpBeliefSchema).max(ICP_BELIEF_LIMIT),
});

export type IcpModel = z.infer<typeof icpModelSchema>;

export const EMPTY_ICP: IcpModel = { beliefs: [] };

export function isCorrection(belief: IcpBelief): boolean {
  return belief.provenance.source === "stated_by_customer";
}

export const RESEARCH_STATUSES = ["never_run", "running", "done", "failed"] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const researchStatusSchema = z.enum(RESEARCH_STATUSES);

// What the model is asked to return. Kept beside the persisted shape so the two cannot
// drift: the persisted row adds provenance the model never supplies.
export const icpReadOutputSchema = z.object({
  beliefs: z
    .array(
      z.object({
        kind: icpBeliefKindSchema,
        statement: z.string().min(1).max(ICP_STATEMENT_MAX),
        citationIndex: z.number().int().nonnegative(),
      }),
    )
    .max(ICP_BELIEF_LIMIT),
});

export const icpResearchPayloadSchema = z.object({
  projectId: z.string().min(1),
});

export type IcpResearchPayload = z.infer<typeof icpResearchPayloadSchema>;

// The worker names the task; the web app queues it. One constant so a typo is a compile
// error rather than a job nothing is registered to run (D9).
export const ICP_RESEARCH_TASK = "icp:research";
