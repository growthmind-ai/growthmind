import { z } from "zod";

export const patienceSchema = z.enum(["low", "medium", "high"]);
export const confidenceSchema = z.enum(["low", "medium", "high"]);

export const personaSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),

    /** Plain English, no steps: a persona that is told where to click cannot get lost. */
    intent: z.string().min(1),

    patience: patienceSchema,
    technicalConfidence: confidenceSchema,
    maxSteps: z.number().int().min(1).max(40),

    /** Values a form may need. `{run}` is replaced with the run id so emails stay unique. */
    facts: z.record(z.string(), z.string()),
  })
  .strict();

export const scenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    startUrl: z.string().min(1),
    viewport: z.object({ width: z.number().int(), height: z.number().int() }).strict(),
    personas: z.array(personaSchema).min(1),
  })
  .strict();

export type Persona = z.infer<typeof personaSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;

// Measured: one-word signals ("400", "posthog") scored hits for claims about other problems.
export const MIN_MATCH_SIGNAL_WORDS = 3;

function isDiscriminating(signal: string): boolean {
  return signal.trim().split(/\s+/).length >= MIN_MATCH_SIGNAL_WORDS;
}

export const keyProblemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    statement: z.string().min(1),

    /** Where in the recorded sessions this shows up, so a human can check the entry. */
    observedIn: z.array(z.string()).min(1),

    /** Cheap deterministic pre-match; a miss here falls through to the model judge. */
    matchAny: z
      .array(
        z
          .string()
          .refine(isDiscriminating, `a match signal needs ${String(MIN_MATCH_SIGNAL_WORDS)} words`),
      )
      .min(1),

    severity: z.enum(["high", "medium", "low"]),
  })
  .strict();

export const answerKeySchema = z
  .object({
    scenarioId: z.string().min(1),
    derivedFromRun: z.string().min(1),
    problems: z.array(keyProblemSchema).min(1),
  })
  .strict();

export type KeyProblem = z.infer<typeof keyProblemSchema>;
export type AnswerKey = z.infer<typeof answerKeySchema>;
