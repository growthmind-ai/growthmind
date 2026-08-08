import { z } from "zod";

export const beatSchema = z.object({ index: z.number().int(), line: z.string() }).strict();

export const sessionSummarySchema = z
  .object({
    sessionId: z.string().min(1),
    outcome: z.enum(["completed", "gave_up", "step_cap", "driver_error"]),
    pages: z.array(z.string()),
    durationMs: z.number(),
    counts: z
      .object({
        clicks: z.number().int(),
        deadClicks: z.number().int(),
        rageClicks: z.number().int(),
        refocuses: z.number().int(),
        abandonedFields: z.number().int(),
        scrollBacks: z.number().int(),
      })
      .strict(),
    /** The page-view stream: rrweb emits no Meta event for a client-side route change. */
    urlTrail: z.array(z.string()),

    beats: z.array(beatSchema),
    consoleErrorCount: z.number().int(),

    /** Distinct messages the recorder itself did not cause; see session/console-noise.ts. */
    consoleErrors: z.array(z.string()),

    /** Off by default: a real recording does not come with an exit interview. */
    exitReason: z.string().nullable(),
  })
  .strict();

/** The analyser's only input. `.strict()` is the enforcement, not the type. */
export const corpusAnalysisInputSchema = z
  .object({
    scenarioId: z.string().min(1),
    startUrl: z.string().min(1),
    sessionsTotal: z.number().int().min(1),
    sessions: z.array(sessionSummarySchema).min(1),
  })
  .strict();

export const citationSchema = z
  .object({
    sessionId: z.string().describe("A session id from the corpus, exactly as given."),
    beat: z.number().int().describe("The numbered beat in that session's list."),
    quote: z.string().describe("The beat's own words, copied."),
  })
  .strict();

export const recommendationSchema = z
  .object({
    action: z.string().describe("The change to make, concrete enough to start on."),
    whereInProduct: z.string().describe("The page or step it applies to."),
    whyItHelps: z.string(),
  })
  .strict();

export const proposedProblemSchema = z
  .object({
    title: z.string(),
    whatWasSeen: z.string().describe("What the sessions show, in plain English."),
    sessionsAffected: z.number().int().describe("How many sessions in this corpus show it."),
    citations: z.array(citationSchema),
    recommendation: recommendationSchema,
  })
  .strict();

export const corpusAnalysisOutputSchema = z.object({ problems: z.array(proposedProblemSchema) });

export type Beat = z.infer<typeof beatSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type CorpusAnalysisInput = z.infer<typeof corpusAnalysisInputSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type ProposedProblem = z.infer<typeof proposedProblemSchema>;
export type CorpusAnalysisOutput = z.infer<typeof corpusAnalysisOutputSchema>;

export type ClaimSupport = "cited" | "unsupported";

export interface AssessedProblem extends ProposedProblem {
  readonly id: string;
  readonly support: ClaimSupport;
  readonly validCitations: number;
  readonly invalidCitations: number;

  /** Always the corpus size, so a claim can never be published without its denominator. */
  readonly sessionsTotal: number;
  readonly claimedMoreThanCorpus: boolean;
}
