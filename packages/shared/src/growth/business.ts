import { z } from "zod";

import { type AudienceRule, audienceProposalSchema } from "./audience";
import { STATEMENT_MAX, factProvenanceSchema } from "./provenance";

// A fact here can kill a fix spec or void a keep-or-kill verdict. Nothing in this group is
// advisory.
export const BINDING_FACT_KINDS = [
  "regime",
  "forbidden_move",
  "load_bearing_friction",
  "conversion",
  "conversion_disqualifier",
  "invalidating_period",
  "who_counts",
] as const;

export type BindingFactKind = (typeof BINDING_FACT_KINDS)[number];

// A fact here shapes how a fix is built, never whether it ships.
export const SHAPING_FACT_KINDS = [
  "decision_cadence",
  "stake_and_reversibility",
  "arrives_expecting",
  "catalogue_scale",
  "staleness_tolerance",
] as const;

export type ShapingFactKind = (typeof SHAPING_FACT_KINDS)[number];

export const BUSINESS_FACT_KINDS = [...BINDING_FACT_KINDS, ...SHAPING_FACT_KINDS] as const;

export type BusinessFactKind = (typeof BUSINESS_FACT_KINDS)[number];

export const businessFactKindSchema = z.enum(BUSINESS_FACT_KINDS);

export const bindingFactKindSchema = z.enum(BINDING_FACT_KINDS);

export const shapingFactKindSchema = z.enum(SHAPING_FACT_KINDS);

export function isBindingKind(kind: BusinessFactKind): kind is BindingFactKind {
  return (BINDING_FACT_KINDS as readonly string[]).includes(kind);
}

// Sessions can only answer what people do. A crawl cannot tell you which friction is
// load-bearing, and behaviour cannot tell you what a regulator forbids.
export const OBSERVABLE_FACT_KINDS = [
  "who_counts",
  "decision_cadence",
  "arrives_expecting",
] as const satisfies readonly BusinessFactKind[];

export function isObservableKind(kind: BusinessFactKind): boolean {
  return (OBSERVABLE_FACT_KINDS as readonly string[]).includes(kind);
}

// No crawl produces these, so a screen offering only correct-and-remove would leave them
// permanently empty with no way to fill them (D11).
export const STATED_ONLY_FACT_KINDS = [
  "load_bearing_friction",
  "conversion",
  "conversion_disqualifier",
  "invalidating_period",
  "staleness_tolerance",
] as const satisfies readonly BusinessFactKind[];

export function isStatedOnlyKind(kind: BusinessFactKind): boolean {
  return (STATED_ONLY_FACT_KINDS as readonly string[]).includes(kind);
}

export const BUSINESS_FACT_LIMIT = 48;

// One kind cannot eat the whole budget: without this a model that finds twelve forbidden
// moves leaves no room for the conversion a person typed.
export const FACTS_PER_KIND_MAX = 4;

export const businessFactSchema = z.object({
  kind: businessFactKindSchema,

  statement: z.string().min(1).max(STATEMENT_MAX),

  provenance: factProvenanceSchema,

  // A correction is the highest-signal row in the table, so it keeps what it replaced
  // rather than overwriting it into silence.
  correctedFrom: z.string().max(STATEMENT_MAX).nullable(),

  // Only `who_counts` carries one, and only once a person has confirmed it does it narrow
  // a denominator. Null on every row written before this field existed.
  audience: audienceProposalSchema.nullable().default(null),
});

export type BusinessFact = z.infer<typeof businessFactSchema>;

export const businessContextSchema = z.object({
  facts: z.array(businessFactSchema).max(BUSINESS_FACT_LIMIT),

  // What a person deleted. A removal that left nothing behind would be undone by the next
  // read of the page the sentence came from.
  removed: z.array(z.string().min(1).max(STATEMENT_MAX)).max(BUSINESS_FACT_LIMIT).default([]),
});

export type BusinessContext = z.infer<typeof businessContextSchema>;

export const EMPTY_BUSINESS_CONTEXT: BusinessContext = { facts: [], removed: [] };

// Separately from the facts, and leniently: rows written before this field existed have no
// `removed` at all, and one unreadable entry must not cost the table its facts.
function readRemoved(value: unknown): string[] {
  const parsed = z.object({ removed: z.array(z.unknown()) }).safeParse(value);
  if (!parsed.success) return [];

  const statements = parsed.data.removed.flatMap((entry) =>
    typeof entry === "string" && entry.length > 0 && entry.length <= STATEMENT_MAX ? [entry] : [],
  );

  return [...new Set(statements)].slice(0, BUSINESS_FACT_LIMIT);
}

// Per fact rather than per column: one row written by a build that named a kind this one
// does not would otherwise empty a customer's whole table (D5).
export function readBusinessContext(value: unknown): BusinessContext {
  const outer = z.object({ facts: z.array(z.unknown()) }).safeParse(value);
  if (!outer.success) return EMPTY_BUSINESS_CONTEXT;

  const facts = outer.data.facts.flatMap((fact) => {
    const parsed = businessFactSchema.safeParse(fact);
    return parsed.success ? [parsed.data] : [];
  });

  return { facts: facts.slice(0, BUSINESS_FACT_LIMIT), removed: readRemoved(value) };
}

export function factsOfKind(
  context: BusinessContext,
  kind: BusinessFactKind,
): readonly BusinessFact[] {
  return context.facts.filter((fact) => fact.kind === kind);
}

// Only a rule a person confirmed narrows anything. A proposal nobody has looked at, and
// one that was rejected, both leave the denominator exactly as wide as it was.
export function confirmedAudienceRules(context: BusinessContext): readonly AudienceRule[] {
  return factsOfKind(context, "who_counts").flatMap((fact) =>
    fact.audience !== null && fact.audience.status === "confirmed" ? [fact.audience.rule] : [],
  );
}

// Order decides who survives, so callers put what a person said first.
export function capFactsPerKind(facts: readonly BusinessFact[]): readonly BusinessFact[] {
  const kept = new Map<string, number>();

  return facts.filter((fact) => {
    const so_far = kept.get(fact.kind) ?? 0;
    if (so_far >= FACTS_PER_KIND_MAX) return false;

    kept.set(fact.kind, so_far + 1);
    return true;
  });
}

const readFactSchema = z.object({
  statement: z.string().min(1).max(STATEMENT_MAX),

  // Which of the supplied pages this came from. The model cites, it does not invent a URL.
  citationIndex: z.number().int().nonnegative(),
});

// Two reads, two schemas: a single call asked for all twelve returned the easy five and
// skipped the constraints, which are the ones a fix spec is gated on.
export const bindingReadOutputSchema = z.object({
  facts: z.array(readFactSchema.extend({ kind: bindingFactKindSchema })).max(BUSINESS_FACT_LIMIT),
});

export const shapingReadOutputSchema = z.object({
  facts: z.array(readFactSchema.extend({ kind: shapingFactKindSchema })).max(BUSINESS_FACT_LIMIT),
});

export const businessResearchPayloadSchema = z.object({
  projectId: z.string().min(1),
});

export type BusinessResearchPayload = z.infer<typeof businessResearchPayloadSchema>;

// The worker names the task; the web app queues it. One constant so a typo is a compile
// error rather than a job nothing is registered to run (D9).
export const BUSINESS_RESEARCH_TASK = "business:research";

// The name this task shipped under. Registered alongside the current one so a job queued
// before the rename runs rather than retrying against nothing forever (D9).
export const BUSINESS_RESEARCH_TASK_BEFORE_RENAME = "icp:research";
