import { z } from "zod";

export const FACT_SOURCES = ["site", "sessions", "stated_by_customer"] as const;

export type FactSource = (typeof FACT_SOURCES)[number];

export const factSourceSchema = z.enum(FACT_SOURCES);

export const STATEMENT_MAX = 400;

// A count never travels without the denominator that makes it mean something.
export const factSeenSchema = z.object({
  sessions: z.number().int().nonnegative(),
  of: z.number().int().positive(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type FactSeen = z.infer<typeof factSeenSchema>;

// O-036: a claim without this is a guess wearing a schema, and §6 applies to us before it
// applies to a customer.
export const factProvenanceSchema = z.object({
  source: factSourceSchema,

  at: z.coerce.date(),

  // The page this was read from. Null for anything not read off the site.
  citation: z.string().max(2048).nullable(),

  // Only the sessions lane fills this, and no row written before it existed carries it.
  seen: factSeenSchema.nullable().default(null),
});

export type FactProvenance = z.infer<typeof factProvenanceSchema>;

export function isObservedProvenance(provenance: FactProvenance): boolean {
  return provenance.source === "sessions";
}

export function isStatedByAPerson(provenance: FactProvenance): boolean {
  return provenance.source === "stated_by_customer";
}

export const RESEARCH_STATUSES = ["never_run", "running", "done", "failed"] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const researchStatusSchema = z.enum(RESEARCH_STATUSES);
