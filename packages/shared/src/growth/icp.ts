import { z } from "zod";

import { STATEMENT_MAX, factProvenanceSchema } from "./provenance";

// What session analysis says about one person's visit. A website cannot answer any of these,
// which is why they no longer appear in settings — see docs/product-decisions.md §6.
export const ICP_BELIEF_KINDS = [
  "who_it_is_for",
  "what_they_expected",
  "what_they_are_trying_to_do",
] as const;

export type IcpBeliefKind = (typeof ICP_BELIEF_KINDS)[number];

export const icpBeliefKindSchema = z.enum(ICP_BELIEF_KINDS);

const RENAMED_BELIEF_KINDS: Readonly<Record<string, IcpBeliefKind>> = {
  what_they_believe: "what_they_expected",
};

// The whole model is read with one safeParse that falls back to an empty one, so a row
// carrying a pre-rename key would silently empty a customer's table rather than fail loudly.
export const persistedIcpBeliefKindSchema = z.preprocess(
  (value) => (typeof value === "string" ? (RENAMED_BELIEF_KINDS[value] ?? value) : value),
  icpBeliefKindSchema,
);

export const ICP_BELIEF_LIMIT = 24;

export const icpBeliefSchema = z.object({
  kind: persistedIcpBeliefKindSchema,

  statement: z.string().min(1).max(STATEMENT_MAX),

  provenance: factProvenanceSchema,

  correctedFrom: z.string().max(STATEMENT_MAX).nullable(),
});

export type IcpBelief = z.infer<typeof icpBeliefSchema>;

export const icpModelSchema = z.object({
  beliefs: z.array(icpBeliefSchema).max(ICP_BELIEF_LIMIT),
});

export type IcpModel = z.infer<typeof icpModelSchema>;

export const EMPTY_ICP: IcpModel = { beliefs: [] };
