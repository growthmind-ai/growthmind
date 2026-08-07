import type { BusinessResearchRow } from "@growthmind/db";
import {
  isBindingKind,
  renderAudienceRule,
  renderSeenSentence,
  type BindingFactKind,
  type BusinessFact,
  type BusinessFactKind,
  type FactProvenance,
  type ShapingFactKind,
} from "@growthmind/shared";

import { ROUTES } from "@/lib/routes";

import {
  CHANGED_LINES,
  KIND_LABELS,
  SETTLED_BY_LINES,
  STATED_ONLY_DOUBTS,
  STATED_ONLY_DOUBT_KINDS,
  type StatedOnlyDoubtKind,
} from "./kinds";

export const AUDIENCE_TITLE = "Who we think this is for";

export const AUDIENCE_LEDE =
  "Our model of your users, not a verdict on them. Every line says where it came from — and what it changed.";

export const BELIEFS_HEADING = "What we believe about them";

export const FACT_ROWS_HEADING = "How they decide, and what they arrive with";

export const CHANGED_HEADING = "What changed, and when";

export const DOUBTS_HEADING = "What we are least sure about — one tap settles it";

export const CLOSING_NOTE =
  "We would rather show you a thin model you can argue with than a confident one you cannot check. If a belief here is wrong, say so — it changes what we rank next.";

// Gating kinds first, and never more than a person will actually answer.
export const DOUBT_CAP = 4;

// Thresholds under which the page says the model is thin rather than letting sparse rows
// pass for a full one.
const THIN_FACTS_UNDER = 5;
const THIN_KINDS_AT_OR_UNDER = 2;

export interface AudienceCta {
  readonly label: string;
  readonly href: string;
}

export interface NoWebsiteView {
  readonly kind: "no-website";
  readonly title: string;
  readonly body: string;
  readonly cta: AudienceCta;
}

export interface ReadingView {
  readonly kind: "reading";
  readonly hostname: string;
  readonly message: string;
}

export interface ReadFailedResearchView {
  readonly kind: "read-failed-research";
  readonly hostname: string;
  readonly message: string;
  readonly cta: AudienceCta;
}

export interface SourcePanelView {
  readonly citationHref: string | null;
  readonly lines: readonly string[];
}

export interface BeliefCardView {
  readonly factKind: BindingFactKind;
  readonly label: string;
  readonly claim: string;

  // What the live claim replaced, rendered struck through beside it. Null when never
  // corrected.
  readonly prior: string | null;

  readonly chips: readonly string[];
  readonly evidence: string;
  readonly changed: string;
  readonly settledBy: string | null;
  readonly source: SourcePanelView;
}

export interface FactRowView {
  readonly factKind: ShapingFactKind;
  readonly label: string;
  readonly claim: string;
  readonly prior: string | null;
  readonly chips: readonly string[];
  readonly evidence: string;
}

export interface ProvenanceStripView {
  readonly builtFrom: string;
  readonly builtOn: string;
  readonly lastChanged: string;
}

export interface ChangedSectionView {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly when: string;
  readonly consequence: string | null;
}

export type AudienceDoubtView =
  | {
      readonly kind: "proposal";
      readonly statement: string;
      readonly text: string;
      readonly confirmLabel: string;
      readonly rejectLabel: string;
      readonly unknownLabel: string;
    }
  | {
      readonly kind: "stated-only";
      readonly factKind: StatedOnlyDoubtKind;
      readonly label: string;
      readonly text: string;
      readonly oneTap: string | null;
      readonly freeTextPrompt: string;
    };

export interface PopulatedAudienceView {
  readonly kind: "populated";
  readonly thin: boolean;
  readonly thinNote: string | null;
  readonly strip: ProvenanceStripView;
  readonly cards: readonly BeliefCardView[];
  readonly rows: readonly FactRowView[];
  readonly latestCorrection: ChangedSectionView | null;
  readonly doubts: readonly AudienceDoubtView[];
}

export type AudienceView =
  NoWebsiteView | ReadingView | ReadFailedResearchView | PopulatedAudienceView;

// UTC and a fixed locale, so the date a server component paints is the date every reader
// sees, whatever their machine says.
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_MS = 86_400_000;

export function buildAudienceView(
  research: BusinessResearchRow | null,
  viewer: { readonly userId: string },
  now: Date = new Date(),
): AudienceView {
  if (research === null) {
    return noWebsite();
  }

  const facts = research.businessContext.facts;

  if (facts.length === 0) {
    if (research.siteDomain === null || research.researchStatus === "never_run") {
      return noWebsite();
    }

    const hostname = hostnameOf(research.siteDomain);

    if (research.researchStatus === "running") {
      return {
        kind: "reading",
        hostname,
        message: `Reading ${hostname} now — beliefs appear here as we find them, each carrying the page it came from.`,
      };
    }

    if (research.researchStatus === "failed") {
      // The persisted failure reason is a vendor's sentence and never reaches the page.
      return {
        kind: "read-failed-research",
        hostname,
        message: `We couldn't read ${hostname}. Your site may have been unreachable.`,
        cta: { label: "Try again from Settings", href: ROUTES.settings },
      };
    }
  }

  // A finished read that admitted nothing still lands here: the doubts are the only way
  // the empty kinds ever fill, so the page asks rather than pretending no site was named.
  return populated(research, facts, viewer.userId, now);
}

function noWebsite(): NoWebsiteView {
  return {
    kind: "no-website",
    title: "No model yet",
    body:
      "Name your website and Growthmind reads it — a bounded set of pages, robots respected. " +
      "Every belief will carry the page it came from. Until there is evidence, this page " +
      "stays empty rather than confident.",
    cta: { label: "Name your website in Settings", href: ROUTES.settings },
  };
}

function populated(
  research: BusinessResearchRow,
  facts: readonly BusinessFact[],
  viewerId: string,
  now: Date,
): PopulatedAudienceView {
  const kindsCovered = new Set(facts.map((fact) => fact.kind)).size;
  const thin = facts.length < THIN_FACTS_UNDER || kindsCovered <= THIN_KINDS_AT_OR_UNDER;

  return {
    kind: "populated",
    thin,
    thinNote: thin ? thinNoteOf(facts.length, kindsCovered) : null,
    strip: stripOf(research, facts, now),
    cards: groupedByKind(facts.filter(isBindingFact)).map((fact) => toCard(fact, viewerId)),
    rows: groupedByKind(facts.filter(isShapingFact)).map((fact) => toRow(fact, viewerId)),
    latestCorrection: latestCorrectionOf(facts),
    doubts: doubtsOf(facts),
  };
}

function thinNoteOf(factCount: number, kindsCovered: number): string {
  const beliefs = factCount === 1 ? "1 belief" : `${factCount} beliefs`;
  return `This model is thin — ${beliefs} across ${kindsCovered} of 12 kinds so far. The doubts below are the fastest way to firm it up.`;
}

type BindingFact = BusinessFact & { readonly kind: BindingFactKind };

type ShapingFact = BusinessFact & { readonly kind: ShapingFactKind };

function isBindingFact(fact: BusinessFact): fact is BindingFact {
  return isBindingKind(fact.kind);
}

function isShapingFact(fact: BusinessFact): fact is ShapingFact {
  return !isBindingKind(fact.kind);
}

// Facts group under their kind label; within a kind the persisted order is the rendered
// order — `capFactsPerKind` already leads with what a person said, and re-sorting here
// would undo the visible rerank a correction earns (FR-9).
function groupedByKind<F extends BusinessFact>(facts: readonly F[]): readonly F[] {
  const order: BusinessFactKind[] = [];
  const byKind = new Map<BusinessFactKind, F[]>();

  for (const fact of facts) {
    const bucket = byKind.get(fact.kind);
    if (bucket === undefined) {
      order.push(fact.kind);
      byKind.set(fact.kind, [fact]);
    } else {
      bucket.push(fact);
    }
  }

  return order.flatMap((kind) => byKind.get(kind) ?? []);
}

function toCard(fact: BindingFact, viewerId: string): BeliefCardView {
  const settledBy = isAssumed(fact.provenance) ? SETTLED_BY_LINES[fact.kind] : null;

  return {
    factKind: fact.kind,
    label: KIND_LABELS[fact.kind],
    claim: fact.statement,
    prior: fact.correctedFrom,
    chips: chipsOf(fact, viewerId),
    evidence: evidenceOf(fact),
    changed: CHANGED_LINES[fact.kind],
    settledBy,
    source: sourcePanelOf(fact, settledBy),
  };
}

function toRow(fact: ShapingFact, viewerId: string): FactRowView {
  return {
    factKind: fact.kind,
    label: KIND_LABELS[fact.kind],
    claim: fact.statement,
    prior: fact.correctedFrom,
    chips: chipsOf(fact, viewerId),
    evidence: evidenceOf(fact),
  };
}

// "you" only on an id match with the viewer; anything else, null included, is "your team".
// A user id or a name never renders (AD-4).
function byWord(actor: string | null, viewerId: string): string {
  return actor !== null && actor === viewerId ? "you" : "your team";
}

function chipsOf(fact: BusinessFact, viewerId: string): readonly string[] {
  const chips: string[] = [];

  if (fact.correctedFrom !== null) {
    chips.push(`corrected by ${byWord(fact.provenance.statedBy, viewerId)}`);
  } else {
    chips.push(sourceChip(fact.provenance));
  }

  if (fact.confirmation !== null) {
    chips.push(`confirmed by ${byWord(fact.confirmation.by, viewerId)}`);
  }

  return chips;
}

// A site fact with no citation is assumed — never worded as a person's statement (FR-3).
function sourceChip(provenance: FactProvenance): string {
  if (provenance.source === "sessions") return "observed";
  if (provenance.source === "stated_by_customer") return "you said this";
  return provenance.citation !== null ? "research" : "assumed";
}

function isAssumed(provenance: FactProvenance): boolean {
  return provenance.source === "site" && provenance.citation === null;
}

function evidenceOf(fact: BusinessFact): string {
  const provenance = fact.provenance;

  if (provenance.seen !== null) return `${renderSeenSentence(provenance.seen)}.`;

  if (provenance.citation !== null) {
    return `Read from ${citationPath(provenance.citation)}, ${DATE.format(provenance.at)}.`;
  }

  if (provenance.source === "stated_by_customer") {
    return `You told us this on ${DATE.format(provenance.at)}.`;
  }

  return "No evidence yet — this is assumed.";
}

function sourcePanelOf(fact: BusinessFact, settledBy: string | null): SourcePanelView {
  const provenance = fact.provenance;
  const lines: string[] = [];

  if (provenance.seen !== null) lines.push(`${renderSeenSentence(provenance.seen)}.`);

  if (provenance.citation !== null) {
    lines.push(`Read from ${citationPath(provenance.citation)}, ${DATE.format(provenance.at)}.`);
  }

  if (provenance.source === "stated_by_customer") {
    lines.push(`You told us this on ${DATE.format(provenance.at)}.`);
  }

  if (isAssumed(provenance)) {
    lines.push(
      "No citation — this is assumed, and the page says so rather than inventing a source.",
    );
    if (settledBy !== null) lines.push(settledBy);
  }

  if (lines.length === 0) lines.push("No evidence yet — this is assumed.");

  if (fact.correctedFrom !== null) lines.push(`Replaced: '${fact.correctedFrom}'`);

  return { citationHref: provenance.citation, lines };
}

function stripOf(
  research: BusinessResearchRow,
  facts: readonly BusinessFact[],
  now: Date,
): ProvenanceStripView {
  const site = facts.filter((fact) => fact.provenance.source === "site");
  const cited = site.filter((fact) => fact.provenance.citation !== null);
  const observed = facts.filter((fact) => fact.provenance.source === "sessions");
  const stated = facts.filter((fact) => fact.provenance.source === "stated_by_customer");
  const corrections = facts.filter((fact) => fact.correctedFrom !== null).length;

  return {
    builtFrom: builtFromOf(research.siteDomain, site, cited, stated.length, corrections),
    builtOn: builtOnOf(cited.length, observed.length, stated.length, site.length - cited.length),
    lastChanged: lastChangedOf(facts, now),
  };
}

function builtFromOf(
  siteDomain: string | null,
  site: readonly BusinessFact[],
  cited: readonly BusinessFact[],
  statedCount: number,
  corrections: number,
): string {
  if (site.length > 0 && siteDomain !== null) {
    const pages = new Set(cited.map((fact) => fact.provenance.citation)).size;
    const suffix = corrections > 0 ? ` · ${counted(corrections, "correction")} from you` : "";
    return `${hostnameOf(siteDomain)} — ${counted(pages, "page")} cited, last read ${DATE.format(latestAt(site))}${suffix}`;
  }

  if (statedCount > 0 || siteDomain === null) {
    return "What you've told us — site not read yet.";
  }

  return `${hostnameOf(siteDomain)} — nothing read into beliefs yet.`;
}

// Every term carries its own count and zero terms are omitted, so nothing here ever claims
// evidence that does not exist.
function builtOnOf(read: number, observed: number, stated: number, assumed: number): string {
  const parts: string[] = [];

  if (read > 0) parts.push(`${read} read from your site`);
  if (observed > 0) parts.push(`${observed} observed in sessions`);
  if (stated > 0) parts.push(`${stated} you told us`);
  if (assumed > 0) parts.push(`${assumed} assumed`);

  return parts.length > 0 ? parts.join(" · ") : "No beliefs yet.";
}

function lastChangedOf(facts: readonly BusinessFact[], now: Date): string {
  if (facts.length === 0) return "Never.";

  const latest = latestAt(facts);
  const when = relativeDay(latest, now);
  const correctedLast = facts.find(
    (fact) => fact.correctedFrom !== null && fact.provenance.at.getTime() === latest.getTime(),
  );

  return correctedLast === undefined
    ? when
    : `${when} — you corrected ${KIND_LABELS[correctedLast.kind]}`;
}

function latestAt(facts: readonly BusinessFact[]): Date {
  return facts.reduce(
    (latest, fact) =>
      fact.provenance.at.getTime() > latest.getTime() ? fact.provenance.at : latest,
    facts[0].provenance.at,
  );
}

function latestCorrectionOf(facts: readonly BusinessFact[]): ChangedSectionView | null {
  let latest: BusinessFact | null = null;

  for (const fact of facts) {
    if (fact.correctedFrom === null) continue;
    if (latest === null || fact.provenance.at.getTime() > latest.provenance.at.getTime()) {
      latest = fact;
    }
  }

  const before = latest?.correctedFrom ?? null;
  if (latest === null || before === null) return null;

  return {
    label: KIND_LABELS[latest.kind],
    before,
    after: latest.statement,
    when: DATE.format(latest.provenance.at),
    consequence: isBindingKind(latest.kind) ? CHANGED_LINES[latest.kind] : null,
  };
}

function doubtsOf(facts: readonly BusinessFact[]): readonly AudienceDoubtView[] {
  const proposals: AudienceDoubtView[] = facts.flatMap((fact) =>
    fact.kind === "who_counts" && fact.audience !== null && fact.audience.status === "proposed"
      ? [
          {
            kind: "proposal" as const,
            statement: fact.statement,
            text: `Whether '${renderAudienceRule(fact.audience.rule)}' is really who counts — it narrows every number we report.`,
            confirmLabel: "Yes — that's who counts",
            rejectLabel: "No — not quite",
            unknownLabel: "We don't know either",
          },
        ]
      : [],
  );

  const unanswered: AudienceDoubtView[] = STATED_ONLY_DOUBT_KINDS.filter(
    (kind) => !facts.some((fact) => fact.kind === kind),
  ).map((kind) => ({
    kind: "stated-only" as const,
    factKind: kind,
    label: KIND_LABELS[kind],
    text: STATED_ONLY_DOUBTS[kind].doubt,
    oneTap: STATED_ONLY_DOUBTS[kind].oneTap,
    freeTextPrompt: STATED_ONLY_DOUBTS[kind].freeTextPrompt,
  }));

  return [...proposals, ...unanswered].slice(0, DOUBT_CAP);
}

function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function hostnameOf(siteDomain: string): string {
  try {
    return new URL(siteDomain.includes("://") ? siteDomain : `https://${siteDomain}`).hostname;
  } catch {
    return siteDomain;
  }
}

function citationPath(citation: string): string {
  try {
    const url = new URL(citation);
    return url.pathname === "/" ? url.hostname : url.pathname;
  } catch {
    return citation;
  }
}

function relativeDay(at: Date, now: Date): string {
  const days = Math.floor(now.getTime() / DAY_MS) - Math.floor(at.getTime() / DAY_MS);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return DATE.format(at);
}
