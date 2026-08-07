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

import type { Read } from "@/lib/read-or-fallback";
import { ROUTES } from "@/lib/routes";

import {
  CHANGED_LINES,
  KIND_COUNT,
  KIND_LABELS,
  SETTLED_BY_LINES,
  STATED_ONLY_DOUBTS,
  STATED_ONLY_DOUBT_KINDS,
  type StatedOnlyDoubtKind,
  type StatedOnlyDoubtOption,
} from "./kinds";

export const AUDIENCE_LEDE =
  "Our model of your users, not a verdict on them. Every line says where it came from — and what it changed.";

// Every verb on this page is revealed by hover, focus or a tap, so a reader who never
// hovers takes the page for a wall of text. The mechanism is said out loud instead.
export const AUDIENCE_AFFORDANCE =
  "Nothing here is fixed. Hover any line — a belief, or a question we are unsure about — to " +
  "confirm it, correct it, answer it, or see where it came from. On a phone, tap the line " +
  "once and the buttons appear.";

export const CLOSING_NOTE =
  "We would rather show you a thin model you can argue with than a confident one you cannot check. If a belief here is wrong, say so — it changes what we rank next.";

// Gating kinds first, and never more than a person will actually answer.
export const DOUBT_CAP = 4;

// Thresholds under which the page says the model is thin rather than letting sparse rows
// pass for a full one.
const THIN_FACTS_UNDER = 5;
const THIN_KINDS_AT_OR_UNDER = 2;

// The website control is the last section of /settings; a bare route drops the reader at
// the top of a page whose named control is a screen further down.
const SETTINGS_BUSINESS = `${ROUTES.settings}#business`;

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

// The model could not be read at all. `null` is also the shape of a workspace with no
// website named, so the two may never share a state.
export interface ReadFailedView {
  readonly kind: "read-failed";
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

// The chip's wording and its tone are decided together here. Two components reading the
// tone back off the label's opening word had already drifted apart, so the discriminant
// travels with the sentence instead.
export type FactChipTone =
  "confirmed" | "corrected" | "observed" | "stated" | "research" | "assumed";

export interface FactChipView {
  readonly label: string;
  readonly tone: FactChipTone;
}

export interface BeliefCardView {
  readonly factKind: BindingFactKind;
  readonly label: string;
  readonly claim: string;

  // What the live claim replaced, rendered struck through beside it. Null when never
  // corrected.
  readonly prior: string | null;

  readonly chips: readonly FactChipView[];
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
  readonly chips: readonly FactChipView[];
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
      readonly oneTap: StatedOnlyDoubtOption | null;
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
  NoWebsiteView | ReadingView | ReadFailedView | ReadFailedResearchView | PopulatedAudienceView;

// UTC and a fixed locale, so the date a server component paints is the date every reader
// sees, whatever their machine says.
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_MS = 86_400_000;

// The page's whole branch, so the failed read cannot be told apart from the empty one only
// by whoever remembers to write the ternary.
export function audienceViewFrom(
  read: Read<BusinessResearchRow | null>,
  viewer: { readonly userId: string },
  now: Date = new Date(),
): AudienceView {
  return read.ok ? buildAudienceView(read.value, viewer, now) : { kind: "read-failed" };
}

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
    if (research.siteDomain === null) {
      return noWebsite();
    }

    const hostname = hostnameOf(research.siteDomain);

    // Naming a website writes never_run; only the worker ever writes running. Folding
    // never_run into the empty state told someone who had just named their site to go and
    // name it. No time is promised here, because nothing here knows one.
    if (research.researchStatus === "never_run") {
      return {
        kind: "reading",
        hostname,
        message: `Queued to read ${hostname} — beliefs appear here as we find them, each carrying the page it came from.`,
      };
    }

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
        cta: { label: "Try again from Settings", href: SETTINGS_BUSINESS },
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
    cta: { label: "Name your website in Settings", href: SETTINGS_BUSINESS },
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
    thinNote: thin ? thinNoteOf(kindsCovered) : null,
    strip: stripOf(research, facts, kindsCovered, now),
    cards: groupedByKind(facts.filter(isBindingFact)).map((fact) => toCard(fact, viewerId)),
    rows: groupedByKind(facts.filter(isShapingFact)).map((fact) => toRow(fact, viewerId)),
    latestCorrection: latestCorrectionOf(facts),
    doubts: doubtsOf(facts),
  };
}

// The belief count is stated by coverage instead of on its own: how many beliefs there
// could have been is not a number anything here knows.
function thinNoteOf(kindsCovered: number): string {
  return `This model is thin — beliefs in just ${kindsCovered} of ${KIND_COUNT} kinds so far. The doubts below are the fastest way to firm it up.`;
}

type BindingFact = BusinessFact & { readonly kind: BindingFactKind };

type ShapingFact = BusinessFact & { readonly kind: ShapingFactKind };

function isBindingFact(fact: BusinessFact): fact is BindingFact {
  return isBindingKind(fact.kind);
}

function isShapingFact(fact: BusinessFact): fact is ShapingFact {
  return !isBindingKind(fact.kind);
}

// What a person touched leads its kind, and that ordering is the whole of the visible
// rerank a correction earns (FR-9, UX §4.4). Nothing upstream does it: `capFactsPerKind`
// is a filter that preserves input order.
const PERSON_TOUCHED = 0;
const CONFIRMED = 1;
const UNTOUCHED = 2;

function touchBand(fact: BusinessFact): number {
  if (fact.correctedFrom !== null || fact.provenance.source === "stated_by_customer") {
    return PERSON_TOUCHED;
  }
  return fact.confirmation !== null ? CONFIRMED : UNTOUCHED;
}

// Facts group under their kind label; within a kind they lead with what a person touched,
// and sort is stable, so persisted order decides everything inside a band.
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

  return order.flatMap((kind) =>
    (byKind.get(kind) ?? []).toSorted((left, right) => touchBand(left) - touchBand(right)),
  );
}

function toCard(fact: BindingFact, viewerId: string): BeliefCardView {
  const settledBy = isAssumed(fact.provenance) ? SETTLED_BY_LINES[fact.kind] : null;

  return {
    factKind: fact.kind,
    label: KIND_LABELS[fact.kind],
    claim: fact.statement,
    prior: fact.correctedFrom,
    chips: chipsOf(fact, viewerId),
    evidence: evidenceOf(fact, viewerId),
    changed: CHANGED_LINES[fact.kind],
    settledBy,
    source: sourcePanelOf(fact, settledBy, viewerId),
  };
}

function toRow(fact: ShapingFact, viewerId: string): FactRowView {
  return {
    factKind: fact.kind,
    label: KIND_LABELS[fact.kind],
    claim: fact.statement,
    prior: fact.correctedFrom,
    chips: chipsOf(fact, viewerId),
    evidence: evidenceOf(fact, viewerId),
  };
}

// "you" only on an id match with the viewer; anything else, null included, is "your team".
// A user id or a name never renders (AD-4).
function byWord(actor: string | null, viewerId: string): string {
  return actor !== null && actor === viewerId ? "you" : "your team";
}

function chipsOf(fact: BusinessFact, viewerId: string): readonly FactChipView[] {
  const chips: FactChipView[] = [];

  if (fact.correctedFrom !== null) {
    chips.push({
      label: `corrected by ${byWord(fact.provenance.statedBy, viewerId)}`,
      tone: "corrected",
    });
  } else {
    chips.push(sourceChip(fact.provenance));
  }

  if (fact.confirmation !== null) {
    chips.push({
      label: `confirmed by ${byWord(fact.confirmation.by, viewerId)}`,
      tone: "confirmed",
    });
  }

  return chips;
}

// A site fact with no citation is assumed — never worded as a person's statement (FR-3).
function sourceChip(provenance: FactProvenance): FactChipView {
  if (provenance.source === "sessions") return { label: "observed", tone: "observed" };
  if (provenance.source === "stated_by_customer") {
    return { label: "you said this", tone: "stated" };
  }
  return provenance.citation !== null
    ? { label: "research", tone: "research" }
    : { label: "assumed", tone: "assumed" };
}

function isAssumed(provenance: FactProvenance): boolean {
  return provenance.source === "site" && provenance.citation === null;
}

// The sentence has to agree with the chip a line above it: a teammate's statement told the
// reader "You told us this" about something they never said (AD-4).
function toldUsSentence(provenance: FactProvenance, viewerId: string): string {
  const who = byWord(provenance.statedBy, viewerId) === "you" ? "You" : "Your team";
  return `${who} told us this on ${DATE.format(provenance.at)}.`;
}

function evidenceOf(fact: BusinessFact, viewerId: string): string {
  const provenance = fact.provenance;

  if (provenance.seen !== null) return `${renderSeenSentence(provenance.seen)}.`;

  if (provenance.citation !== null) {
    return `Read from ${citationPath(provenance.citation)}, ${DATE.format(provenance.at)}.`;
  }

  if (provenance.source === "stated_by_customer") {
    return toldUsSentence(provenance, viewerId);
  }

  return "No evidence yet — this is assumed.";
}

function sourcePanelOf(
  fact: BusinessFact,
  settledBy: string | null,
  viewerId: string,
): SourcePanelView {
  const provenance = fact.provenance;
  const lines: string[] = [];

  if (provenance.seen !== null) lines.push(`${renderSeenSentence(provenance.seen)}.`);

  if (provenance.citation !== null) {
    lines.push(`Read from ${citationPath(provenance.citation)}, ${DATE.format(provenance.at)}.`);
  }

  if (provenance.source === "stated_by_customer") {
    lines.push(toldUsSentence(provenance, viewerId));
  }

  if (isAssumed(provenance)) {
    lines.push(
      "No citation — this is assumed, and the page says so rather than inventing a source.",
    );
    if (settledBy !== null) lines.push(settledBy);
  }

  if (lines.length === 0) lines.push("No evidence yet — this is assumed.");

  if (fact.correctedFrom !== null) lines.push(`Replaced: '${fact.correctedFrom}'`);

  return { citationHref: linkableCitation(provenance.citation), lines };
}

// A citation is persisted as free text, and only a web address is safe to hand to an
// anchor. Anything else keeps its evidence line and loses its link — the panel already
// renders without one.
function linkableCitation(citation: string | null): string | null {
  if (citation === null) return null;

  try {
    const { protocol } = new URL(citation);
    return protocol === "http:" || protocol === "https:" ? citation : null;
  } catch {
    return null;
  }
}

function stripOf(
  research: BusinessResearchRow,
  facts: readonly BusinessFact[],
  kindsCovered: number,
  now: Date,
): ProvenanceStripView {
  const site = facts.filter((fact) => fact.provenance.source === "site");
  const cited = site.filter((fact) => fact.provenance.citation !== null);
  const observed = facts.filter((fact) => fact.provenance.source === "sessions");
  const stated = facts.filter((fact) => fact.provenance.source === "stated_by_customer");
  const corrections = facts.filter((fact) => fact.correctedFrom !== null).length;

  return {
    builtFrom: builtFromOf(research.siteDomain, site, cited, stated.length, {
      corrections,
      beliefs: facts.length,
    }),
    builtOn: builtOnOf(
      { read: cited.length, observed: observed.length, stated: stated.length },
      site.length - cited.length,
      kindsCovered,
    ),
    lastChanged: lastChangedOf(facts, now),
  };
}

function builtFromOf(
  siteDomain: string | null,
  site: readonly BusinessFact[],
  cited: readonly BusinessFact[],
  statedCount: number,
  of: { readonly corrections: number; readonly beliefs: number },
): string {
  if (site.length > 0 && siteDomain !== null) {
    const suffix =
      of.corrections > 0 ? ` · ${of.corrections} of ${of.beliefs} beliefs corrected by you` : "";
    return `${hostnameOf(siteDomain)} — ${citedPagesOf(cited, of.beliefs)}, last read ${DATE.format(latestAt(site))}${suffix}`;
  }

  if (statedCount > 0 || siteDomain === null) {
    return "What you've told us — site not read yet.";
  }

  return `${hostnameOf(siteDomain)} — nothing read into beliefs yet.`;
}

// Nothing persists how many pages the read fetched, so "N pages cited" has no denominator
// available and the count is dropped rather than given an invented one (AGENTS.md: every
// number says out of how many). A short list is named outright; past that the line falls
// back to the share of beliefs citing a page, which the row does know.
const NAMED_PAGES_MAX = 4;

function citedPagesOf(cited: readonly BusinessFact[], beliefs: number): string {
  const pages = [
    ...new Set(
      cited
        .map((fact) => fact.provenance.citation)
        .filter((citation): citation is string => citation !== null)
        .map(citationPath),
    ),
  ];

  return pages.length > 0 && pages.length <= NAMED_PAGES_MAX
    ? `${listOf(pages)} cited`
    : `${cited.length} of ${beliefs} beliefs cite a page`;
}

function listOf(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Zero terms are omitted, so nothing here claims evidence that does not exist, and every
// count carries the denominator that makes it mean something — the beliefs it is a share of,
// and for coverage the twelve kinds there are to cover (UX §4.3).
function builtOnOf(
  sourced: { readonly read: number; readonly observed: number; readonly stated: number },
  assumed: number,
  kindsCovered: number,
): string {
  const total = sourced.read + sourced.observed + sourced.stated + assumed;
  if (total === 0) return "No beliefs yet.";

  const parts: string[] = [];

  if (sourced.read > 0) parts.push(`${sourced.read} of ${total} read from your site`);
  if (sourced.observed > 0) parts.push(`${sourced.observed} of ${total} observed in sessions`);
  if (sourced.stated > 0) parts.push(`${sourced.stated} of ${total} you told us`);
  if (assumed > 0) parts.push(`${assumed} of ${total} assumed`);

  parts.push(`${kindsCovered} of ${KIND_COUNT} kinds have at least one belief`);

  return parts.join(" · ");
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
