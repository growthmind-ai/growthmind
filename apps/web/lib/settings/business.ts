// No database import in this file, deliberately: the settings components are client
// components and import these as values, so anything reachable from here reaches the browser
// bundle. The reader that needs the database lives in `site.ts`.
import {
  BINDING_FACT_KINDS,
  SHAPING_FACT_KINDS,
  isObservableKind,
  isObservedProvenance,
  isStatedOnlyKind,
  renderSeenSentence,
  type BusinessContext,
  type BusinessFact,
  type BusinessFactKind,
  type ResearchStatus,
} from "@growthmind/shared";

// What this business says of itself. Editable, because it is the customer's own claim.
export interface StatedFactView {
  readonly kind: BusinessFactKind;
  readonly statement: string;

  // Null when a person told us rather than a page saying it.
  readonly readFrom: string | null;

  // What this replaced, when a person corrected it.
  readonly correctedFrom: string | null;
}

// What people were observed doing. Not editable: a person may argue with their own copy,
// not with what someone did.
export interface ObservedFactView {
  readonly kind: BusinessFactKind;
  readonly statement: string;
  readonly evidence: string | null;
}

export interface FactLaneView {
  readonly kind: BusinessFactKind;

  // No crawl proposes this kind, so the lane offers adding rather than only correcting.
  readonly statedOnly: boolean;

  // Sessions can never answer some of these, and an empty lane that will never fill is a
  // dead end rather than a promise.
  readonly observable: boolean;

  readonly stated: readonly StatedFactView[];
  readonly observed: readonly ObservedFactView[];
}

export interface BusinessResearchView {
  readonly domain: string | null;
  readonly status: ResearchStatus;
  readonly failure: string | null;
  readonly binding: readonly FactLaneView[];
  readonly shaping: readonly FactLaneView[];
}

function emptyLanes(kinds: readonly BusinessFactKind[]): readonly FactLaneView[] {
  return kinds.map((kind) => ({
    kind,
    statedOnly: isStatedOnlyKind(kind),
    observable: isObservableKind(kind),
    stated: [],
    observed: [],
  }));
}

export const NOTHING_READ: BusinessResearchView = {
  domain: null,
  status: "never_run",
  failure: null,
  binding: emptyLanes(BINDING_FACT_KINDS),
  shaping: emptyLanes(SHAPING_FACT_KINDS),
};

export function hasAnyFact(lanes: readonly FactLaneView[]): boolean {
  return lanes.some((lane) => lane.stated.length > 0 || lane.observed.length > 0);
}

function toLanes(
  kinds: readonly BusinessFactKind[],
  facts: readonly BusinessFact[],
): readonly FactLaneView[] {
  return kinds.map((kind) => {
    const forKind = facts.filter((fact) => fact.kind === kind);

    return {
      kind,
      statedOnly: isStatedOnlyKind(kind),
      observable: isObservableKind(kind),
      stated: forKind
        .filter((fact) => !isObservedProvenance(fact.provenance))
        .map((fact) => ({
          kind,
          statement: fact.statement,
          readFrom: fact.provenance.citation,
          correctedFrom: fact.correctedFrom,
        })),
      observed: forKind
        .filter((fact) => isObservedProvenance(fact.provenance))
        .map((fact) => ({
          kind,
          statement: fact.statement,
          evidence: fact.provenance.seen === null ? null : renderSeenSentence(fact.provenance.seen),
        })),
    };
  });
}

export function toBindingLanes(context: BusinessContext): readonly FactLaneView[] {
  return toLanes(BINDING_FACT_KINDS, context.facts);
}

export function toShapingLanes(context: BusinessContext): readonly FactLaneView[] {
  return toLanes(SHAPING_FACT_KINDS, context.facts);
}
