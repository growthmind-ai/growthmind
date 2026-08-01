// The T1 event-vocabulary probe's pure core.
//
// Pure: no clock, no I/O, no module-scope state read inside a judgement. Every function
// here is unit-tested in `__tests__/t1-vocabulary.test.ts`, which is the specification.
// The impure shell that feeds it lives in `../t1-event-vocabulary-probe.ts`.
//
// Why this module exists, and the one rule it encodes could not pin …
// (`$rageclick`, `$dead_click`/`$dead_swipe`, `$autocapture`, `$pageview`) because the
// project it read held 220 events, all of them written by this repo's own spikes, and
// zero originating from a browser SDK. Zero observations of a browser event in that
// corpus measures our own synthetic writes, not the customer's client config. Calling
// that `PINNED — absent` would have shipped `rage_click`/`dead_click` as "does not
// exist" on the strength of a sample that could never have contained them.
//
// So: **presence and absence are not symmetric.**
//
// `PINNED — present` needs one observation. A single `$rageclick` proves
//  the vocabulary outright; no denominator, no representativeness, nothing
//  else to argue about. Presence is self-evidencing.
// `PINNED — absent` needs a sample that could have contained the event.
//  That judgement is `judgeRepresentativeness`, and it is structural here,
//  not a convention: the absent arm of `RowVerdict` carries a
//  `RepresentativeSample`, whose only producer is `judgeRepresentativeness`
//  and which a `NonRepresentativeSample` is not assignable to. There is no
//  way to construct a `PINNED — absent` verdict without one in hand.
// Everything else is `FAILED-TO-PIN`. Inconclusive, re-runnable, and a
//  detector is never built on it.
//
// Fail direction: every classification here fails toward `FAILED-TO-PIN`. An
// unrecognised `$lib` is not counted as browser traffic, an unparseable row is dropped
// from the denominator, and both push the sample further from "representative". I.e.
// away from an absence claim we cannot support. Over-claiming absence is the failure
// this module exists to prevent; over-claiming inconclusiveness merely costs a re-run.

// The sample

/**
 * One event, reduced to exactly what the vocabulary question needs. Built from the
 * events list api's raw items, which are `unknown` by construction: a live project
 * holds every payload shape ever written to it, so nothing here trusts a declared type.
 */
export interface ObservedEvent {
  /** The event name literal, verbatim (`$rageclick`, `gm_shape_probe`, …). */
  readonly name: string;
  /** `properties.$lib`, or null when the event carried none. */
  readonly lib: string | null;
  /** Parsed `timestamp`, or null when it was absent or unparseable. */
  readonly occurredAt: Date | null;
}

/** One event name and how many times the sample carried it. */
export interface EventNameCount {
  readonly name: string;
  readonly count: number;
}

/** The span the sample actually covers. The "window achieved", not requested. */
export interface ObservedWindow {
  readonly earliest: Date;
  readonly latest: Date;
}

/**
 * The event-name histogram, carrying its own denominator.
 *
 * `denominator` is the whole point: a count without one is a number nobody can argue
 * with, and the entire … conclusion turned on "0 / 220" being readable as a ratio
 * rather than as a zero. `counts` never omits a name it observed, and never invents one
 * it did not.
 */
export interface EventNameHistogram {
  /** Total events the histogram was built from. The denominator every count is over. */
  readonly denominator: number;
  /** Observed names, count descending, ties broken by name ascending. */
  readonly counts: readonly EventNameCount[];
  /** The span the sample covers, or null when no event carried a usable timestamp. */
  readonly window: ObservedWindow | null;
}

// Representativeness, the gate on the absent verdict

/**
 * The rules the representativeness judgement runs under, passed as a parameter to every
 * function that consults them, never read from module scope inside a judgement. A gate
 * whose thresholds are reachable only through its argument is a gate a test can move;
 * one that reads a constant internally is a gate a test can only agree with.
 */
export interface RepresentativenessRules {
  readonly version: number;
  /**
   * `$lib` values that count as a real browser client. An allow-list, never a
   * deny-list: an unrecognised `$lib` is not browser traffic, which withholds an
   * absence claim rather than manufacturing one (fail direction).
   */
  readonly browserOriginLibs: readonly string[];
  /**
   * The minimum browser-originated events an absence claim needs behind it: 220
   * synthetic events were "far under the ~50-real-browser-event bar that would make an
   * absence claim meaningful".
   */
  readonly minimumBrowserOriginatedEvents: number;
}

/** `$lib` values posthog-js reports from a browser. */
export const BROWSER_ORIGIN_LIBS_V1: readonly string[] = ["web", "posthog-js"];

/** the stated bar for a meaningful absence claim. */
export const MINIMUM_BROWSER_ORIGINATED_EVENTS_V1 = 50;

export const REPRESENTATIVENESS_RULES_VERSION = 1;

export const CURRENT_REPRESENTATIVENESS_RULES: RepresentativenessRules = {
  version: REPRESENTATIVENESS_RULES_VERSION,
  browserOriginLibs: BROWSER_ORIGIN_LIBS_V1,
  minimumBrowserOriginatedEvents: MINIMUM_BROWSER_ORIGINATED_EVENTS_V1,
};

/**
 * Why a sample cannot carry an absence claim. Two reasons, both named. The first is the
 * exact situation, the second is the near-miss beside it (a project with some real
 * browser traffic, but not enough of it).
 */
export type NonRepresentativeReason =
  "no_browser_originated_events" | "below_minimum_browser_denominator";

/** The counted evidence behind a representativeness judgement, either way. */
export interface SampleBasis {
  /** Every event in the sample, browser-originated or not. */
  readonly totalEvents: number;
  /** Events whose `$lib` is on the rules' allow-list. */
  readonly browserOriginatedEvents: number;
  /** Every distinct `$lib` observed, ascending. `null` libs are reported as "(absent)". */
  readonly observedLibs: readonly string[];
  /** The bar this judgement was made against, carried so a verdict re-reads. */
  readonly minimumBrowserOriginatedEvents: number;
}

/**
 * A sample that could have contained the events under test. The only type an absent
 * verdict accepts, and `judgeRepresentativeness` is its only producer.
 */
export interface RepresentativeSample {
  readonly kind: "representative";
  readonly basis: SampleBasis;
}

/** A sample whose silence says nothing about the customer's client config. */
export interface NonRepresentativeSample {
  readonly kind: "not_representative";
  readonly reason: NonRepresentativeReason;
  readonly basis: SampleBasis;
}

export type Representativeness = RepresentativeSample | NonRepresentativeSample;

// Rows and verdicts

/**
 * One vocabulary claim under test. `eventNames` is the set of literals whose presence
 * would settle the row. More than one where the row asks about a family ( asks about
 * `$dead_click` and `$dead_swipe`).
 */
export interface VocabularyRow {
  /** the row id, so a re-run's output lines up against the original table. */
  readonly id: string;
  readonly claim: string;
  readonly eventNames: readonly string[];
}

/**
 * the sample-observable rows. and are deliberately absent: both are static
 * source verifications about what the adapter reads, settled by reading
 * `constants.ts`/`parse.ts`, and no volume of live traffic can move either. A probe
 * that pretended to re-test them would be reporting a verdict it never measured.
 */
export const VOCABULARY_ROWS: readonly VocabularyRow[] = [
  {
    id: "A-1",
    claim: "$exception arrives in the events list API",
    eventNames: ["$exception"],
  },
  {
    id: "A-2",
    claim: "$rageclick arrives in the events list API",
    eventNames: ["$rageclick"],
  },
  {
    id: "A-3",
    claim: "$dead_click / $dead_swipe arrive in the events list API",
    eventNames: ["$dead_click", "$dead_swipe"],
  },
  {
    id: "A-4",
    claim: "$autocapture arrives in the events list API",
    eventNames: ["$autocapture"],
  },
  {
    id: "A-5",
    claim: "$pageview arrives in the events list API",
    eventNames: ["$pageview"],
  },
];

/** The three verdicts a row can carry. The em dashes are the, verbatim. */
export type VerdictLabel = "PINNED — present" | "PINNED — absent" | "FAILED-TO-PIN";

/**
 * A row's verdict, with the evidence that licensed it.
 *
 * The asymmetry between the arms IS the contract:
 * `present` carries the observed literals, one sighting settles the row,
 *  so it needs no representativeness at all.
 * `absent` carries a `RepresentativeSample`, and nothing else can be
 *  supplied in its place. This is the lesson made unrepresentable
 *  rather than merely documented.
 * `FAILED-TO-PIN` carries the `NonRepresentativeSample` that blocked the
 *  absent verdict, so the output says why it is inconclusive and what would
 *  make a re-run conclusive.
 */
export type RowVerdict =
  | {
      readonly row: VocabularyRow;
      readonly label: "PINNED — present";
      /** Every name from the row that was actually observed, with its count. */
      readonly observed: readonly EventNameCount[];
      readonly denominator: number;
    }
  | {
      readonly row: VocabularyRow;
      readonly label: "PINNED — absent";
      /** The gate. Only `judgeRepresentativeness` produces one of these. */
      readonly basis: RepresentativeSample;
      readonly denominator: number;
    }
  | {
      readonly row: VocabularyRow;
      readonly label: "FAILED-TO-PIN";
      readonly basis: NonRepresentativeSample;
      readonly denominator: number;
    };

/** The whole run's pure result. What gets printed and written to local/spikes/. */
export interface VocabularyReport {
  readonly probe: "t1-event-vocabulary";
  readonly rulesVersion: number;
  readonly histogram: EventNameHistogram;
  readonly representativeness: Representativeness;
  readonly verdicts: readonly RowVerdict[];
}

// Pure helpers

/**
 * What a `null` `$lib` is reported as in `SampleBasis.observedLibs`. An event with no
 * `$lib` still counts in the denominator and still shows up in the observed-lib list.
 * Omitting it would hide the very thing ruling 11 asks a human to confirm before
 * trusting an absence claim.
 */
const ABSENT_LIB_LABEL = "(absent)";

/** Narrowing guard: a plain object usable as a string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Code-unit string order, the same ordering `canonicalJson` uses, so every
 * deterministic ordering in this sprint reads the same way. `localeCompare` would make
 * the output depend on the runner's locale.
 */
function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** `properties.$lib` when it is a non-empty string, else null. */
function libOf(item: Record<string, unknown>): string | null {
  const { properties } = item;
  if (!isRecord(properties)) return null;
  const lib = properties["$lib"];
  return typeof lib === "string" && lib !== "" ? lib : null;
}

/** `timestamp` parsed to a real instant, else null. Never a fabricated `now`. */
function occurredAtOf(item: Record<string, unknown>): Date | null {
  const { timestamp } = item;
  if (typeof timestamp !== "string") return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reduces raw events-list items to `ObservedEvent`s.
 *
 * An item without a string `event` name is dropped, not defaulted: it cannot answer a
 * vocabulary question, and dropping it shrinks the denominator, which pushes the sample
 * away from "representative". The safe direction. A missing or unparseable
 * `$lib`/`timestamp` becomes `null`; only the name is required.
 */
export function toObservedEvents(rawItems: readonly unknown[]): readonly ObservedEvent[] {
  const sample: ObservedEvent[] = [];
  for (const item of rawItems) {
    if (!isRecord(item)) continue;
    const { event } = item;
    // An empty name is dropped for the same reason a missing one is: it names no
    // vocabulary, and dropping shrinks the denominator (the safe direction).
    if (typeof event !== "string" || event === "") continue;
    sample.push({ name: event, lib: libOf(item), occurredAt: occurredAtOf(item) });
  }
  return sample;
}

/**
 * Builds the event-name histogram, carrying `denominator` = `sample.length`.
 *
 * An empty sample returns `{ denominator: 0, counts: [], window: null }`, never a
 * throw, never a fabricated zero-count row for a name nobody observed.
 */
export function buildEventNameHistogram(sample: readonly ObservedEvent[]): EventNameHistogram {
  const tally = new Map<string, number>();
  let earliest: Date | null = null;
  let latest: Date | null = null;

  for (const event of sample) {
    tally.set(event.name, (tally.get(event.name) ?? 0) + 1);

    // The window spans the earliest and latest usable timestamps. Scanned, not read off
    // the first and last array positions, which the api's ordering does not guarantee
    // and a null timestamp would break outright.
    const { occurredAt } = event;
    if (occurredAt === null) continue;
    if (earliest === null || occurredAt.getTime() < earliest.getTime()) earliest = occurredAt;
    if (latest === null || occurredAt.getTime() > latest.getTime()) latest = occurredAt;
  }

  const counts = [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .toSorted((left, right) => right.count - left.count || byCodeUnit(left.name, right.name));

  return {
    denominator: sample.length,
    counts,
    window: earliest === null || latest === null ? null : { earliest, latest },
  };
}

/**
 * Whether one event came from a real browser client, per the rules' allow-list.
 *
 * A `null` lib is not browser-originated. Neither is an unrecognised one, including a
 * future posthog-js `$lib` value this list has not learned yet. That miss costs a
 * `FAILED-TO-PIN` and a line in the report saying which libs were observed; the
 * opposite fail direction would let our own synthetic `gm-shape-probe` writes
 * underwrite an absence claim, which is precisely.
 */
export function isBrowserOriginated(event: ObservedEvent, rules: RepresentativenessRules): boolean {
  const { lib } = event;
  return lib !== null && rules.browserOriginLibs.includes(lib);
}

/**
 * The gate. Decides whether this sample can carry an absence claim at all.
 *
 * `representative` iff both hold:
 * 1. at least one event is browser-originated per `isBrowserOriginated`, and
 * 2. the browser-originated count is `>=`
 *  `rules.minimumBrowserOriginatedEvents` (inclusive — a sample sitting
 *  exactly on the bar passes; the fail direction is carried by the
 *  magnitude of the bar, never by the strictness of the comparison).
 *
 * Otherwise `not_representative`, with `no_browser_originated_events` when the count is
 * zero (the exact situation) and `below_minimum_browser_denominator` when it is
 * non-zero but under the bar. `basis` is populated identically either way, so the
 * report can state the numbers whichever branch it took.
 */
export function judgeRepresentativeness(
  sample: readonly ObservedEvent[],
  rules: RepresentativenessRules,
): Representativeness {
  let browserOriginatedEvents = 0;
  const libs = new Set<string>();

  for (const event of sample) {
    if (isBrowserOriginated(event, rules)) browserOriginatedEvents++;
    libs.add(event.lib ?? ABSENT_LIB_LABEL);
  }

  // Populated identically on both branches: the report states the numbers whichever way
  // the judgement went, so a failed-to-pin line says how far short the sample fell
  // rather than merely that it did.
  const basis: SampleBasis = {
    totalEvents: sample.length,
    browserOriginatedEvents,
    observedLibs: [...libs].toSorted(byCodeUnit),
    minimumBrowserOriginatedEvents: rules.minimumBrowserOriginatedEvents,
  };

  if (browserOriginatedEvents === 0) {
    return { kind: "not_representative", reason: "no_browser_originated_events", basis };
  }
  if (browserOriginatedEvents < rules.minimumBrowserOriginatedEvents) {
    return { kind: "not_representative", reason: "below_minimum_browser_denominator", basis };
  }
  return { kind: "representative", basis };
}

/**
 * The per-row verdict.
 *
 * Order of decision, presence first, and independently of the gate:
 * 1. any of `row.eventNames` observed in `histogram` with count `>= 1`
 *  → `PINNED — present`, carrying the exact observed literals and counts.
 *  Representativeness is not consulted: one real sighting settles it.
 * 2. none observed and `representativeness.kind === "representative"`
 *  → `PINNED — absent`, carrying that sample as its basis.
 * 3. none observed and the sample is not representative
 *  → `FAILED-TO-PIN`, carrying the reason.
 *
 * `denominator` is `histogram.denominator` on every arm, so no verdict line can be read
 * without the number it was measured against.
 */
export function verdictForRow(
  row: VocabularyRow,
  histogram: EventNameHistogram,
  representativeness: Representativeness,
): RowVerdict {
  const { denominator } = histogram;

  // Only literals the histogram actually carries. A verdict never reports a name it did
  // not see, so a family row lists exactly the half observed.
  const observed = row.eventNames.flatMap((name) => {
    const entry = histogram.counts.find((candidate) => candidate.name === name);
    return entry !== undefined && entry.count >= 1 ? [entry] : [];
  });

  // Presence first, and the gate is not consulted: one sighting settles a row.
  if (observed.length > 0) {
    return { row, label: "PINNED — present", observed, denominator };
  }
  // Absence is the gated arm. TypeScript enforces it too. The basis below is narrowed
  // to `RepresentativeSample`, which is the whole of the lesson.
  if (representativeness.kind === "representative") {
    return { row, label: "PINNED — absent", basis: representativeness, denominator };
  }
  return { row, label: "FAILED-TO-PIN", basis: representativeness, denominator };
}

/**
 * Composes the whole judgement: histogram, then the gate once for the sample, then one
 * verdict per row against that single judgement.
 *
 * The gate is evaluated once and shared deliberately. Representativeness is a property
 * of the sample, not of a row, and re-deriving it per row is how the two drift apart.
 */
export function buildVocabularyReport(
  sample: readonly ObservedEvent[],
  rows: readonly VocabularyRow[],
  rules: RepresentativenessRules,
): VocabularyReport {
  const histogram = buildEventNameHistogram(sample);
  // Once, for the sample. Every verdict below is held to this one judgement.
  const representativeness = judgeRepresentativeness(sample, rules);

  return {
    probe: "t1-event-vocabulary",
    rulesVersion: rules.version,
    histogram,
    representativeness,
    verdicts: rows.map((row) => verdictForRow(row, histogram, representativeness)),
  };
}

/**
 * One printable line per verdict, in the reporting shape:
 * ` FAILED-TO-PIN $rageclick 0 / 220 — no browser-originated events…`
 *
 * Pure and therefore testable, but not trusted to be safe on its own: the entrypoint
 * pipes every line through `lib/redact.ts` before it reaches stdout or disk, because an
 * event name is customer-authored text and can carry an identifier we never
 * anticipated.
 */
export function formatVerdictLine(verdict: RowVerdict): string {
  const { row, denominator } = verdict;
  const asked = row.eventNames.join(", ");

  switch (verdict.label) {
    case "PINNED — present": {
      const seen = verdict.observed.reduce((sum, entry) => sum + entry.count, 0);
      const names = verdict.observed.map((entry) => entry.name).join(", ");
      return (
        `${row.id}  ${verdict.label}  ${names}  ${seen} / ${denominator} — ` +
        "observed; one sighting settles the row, so the representativeness gate is not consulted"
      );
    }
    case "PINNED — absent": {
      const { basis } = verdict.basis;
      return (
        `${row.id}  ${verdict.label}  ${asked}  0 / ${denominator} — ` +
        `not observed in a sample that could have carried it ` +
        `(${basis.browserOriginatedEvents} browser-originated of ${basis.totalEvents}, ` +
        `bar ${basis.minimumBrowserOriginatedEvents})`
      );
    }
    case "FAILED-TO-PIN": {
      const { reason, basis } = verdict.basis;
      return (
        `${row.id}  ${verdict.label}  ${asked}  0 / ${denominator} — ${reason}: ` +
        `${basis.browserOriginatedEvents} browser-originated of ${basis.totalEvents} ` +
        `(bar ${basis.minimumBrowserOriginatedEvents}). This is NOT an absence result — ` +
        "re-run against a project a real posthog-js page has touched."
      );
    }
  }
}
