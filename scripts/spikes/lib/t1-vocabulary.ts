export interface ObservedEvent {
  readonly name: string;

  readonly lib: string | null;

  readonly occurredAt: Date | null;
}

export interface EventNameCount {
  readonly name: string;
  readonly count: number;
}

export interface ObservedWindow {
  readonly earliest: Date;
  readonly latest: Date;
}

export interface EventNameHistogram {
  readonly denominator: number;

  readonly counts: readonly EventNameCount[];

  readonly window: ObservedWindow | null;
}

export interface RepresentativenessRules {
  readonly version: number;

  readonly browserOriginLibs: readonly string[];

  readonly minimumBrowserOriginatedEvents: number;
}

export const BROWSER_ORIGIN_LIBS_V1: readonly string[] = ["web", "posthog-js"];

export const MINIMUM_BROWSER_ORIGINATED_EVENTS_V1 = 50;

export const REPRESENTATIVENESS_RULES_VERSION = 1;

export const CURRENT_REPRESENTATIVENESS_RULES: RepresentativenessRules = {
  version: REPRESENTATIVENESS_RULES_VERSION,
  browserOriginLibs: BROWSER_ORIGIN_LIBS_V1,
  minimumBrowserOriginatedEvents: MINIMUM_BROWSER_ORIGINATED_EVENTS_V1,
};

export type NonRepresentativeReason =
  "no_browser_originated_events" | "below_minimum_browser_denominator";

export interface SampleBasis {
  readonly totalEvents: number;

  readonly browserOriginatedEvents: number;

  readonly observedLibs: readonly string[];

  readonly minimumBrowserOriginatedEvents: number;
}

export interface RepresentativeSample {
  readonly kind: "representative";
  readonly basis: SampleBasis;
}

export interface NonRepresentativeSample {
  readonly kind: "not_representative";
  readonly reason: NonRepresentativeReason;
  readonly basis: SampleBasis;
}

export type Representativeness = RepresentativeSample | NonRepresentativeSample;

export interface VocabularyRow {
  readonly id: string;
  readonly claim: string;
  readonly eventNames: readonly string[];
}

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

export type VerdictLabel = "PINNED — present" | "PINNED — absent" | "FAILED-TO-PIN";

export type RowVerdict =
  | {
      readonly row: VocabularyRow;
      readonly label: "PINNED — present";

      readonly observed: readonly EventNameCount[];
      readonly denominator: number;
    }
  | {
      readonly row: VocabularyRow;
      readonly label: "PINNED — absent";

      readonly basis: RepresentativeSample;
      readonly denominator: number;
    }
  | {
      readonly row: VocabularyRow;
      readonly label: "FAILED-TO-PIN";
      readonly basis: NonRepresentativeSample;
      readonly denominator: number;
    };

export interface VocabularyReport {
  readonly probe: "t1-event-vocabulary";
  readonly rulesVersion: number;
  readonly histogram: EventNameHistogram;
  readonly representativeness: Representativeness;
  readonly verdicts: readonly RowVerdict[];
}

const ABSENT_LIB_LABEL = "(absent)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function libOf(item: Record<string, unknown>): string | null {
  const { properties } = item;
  if (!isRecord(properties)) return null;
  const lib = properties["$lib"];
  return typeof lib === "string" && lib !== "" ? lib : null;
}

function occurredAtOf(item: Record<string, unknown>): Date | null {
  const { timestamp } = item;
  if (typeof timestamp !== "string") return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toObservedEvents(rawItems: readonly unknown[]): readonly ObservedEvent[] {
  const sample: ObservedEvent[] = [];
  for (const item of rawItems) {
    if (!isRecord(item)) continue;
    const { event } = item;

    if (typeof event !== "string" || event === "") continue;
    sample.push({ name: event, lib: libOf(item), occurredAt: occurredAtOf(item) });
  }
  return sample;
}

export function buildEventNameHistogram(sample: readonly ObservedEvent[]): EventNameHistogram {
  const tally = new Map<string, number>();
  let earliest: Date | null = null;
  let latest: Date | null = null;

  for (const event of sample) {
    tally.set(event.name, (tally.get(event.name) ?? 0) + 1);

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

export function isBrowserOriginated(event: ObservedEvent, rules: RepresentativenessRules): boolean {
  const { lib } = event;
  return lib !== null && rules.browserOriginLibs.includes(lib);
}

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

export function verdictForRow(
  row: VocabularyRow,
  histogram: EventNameHistogram,
  representativeness: Representativeness,
): RowVerdict {
  const { denominator } = histogram;

  const observed = row.eventNames.flatMap((name) => {
    const entry = histogram.counts.find((candidate) => candidate.name === name);
    return entry !== undefined && entry.count >= 1 ? [entry] : [];
  });

  if (observed.length > 0) {
    return { row, label: "PINNED — present", observed, denominator };
  }

  if (representativeness.kind === "representative") {
    return { row, label: "PINNED — absent", basis: representativeness, denominator };
  }
  return { row, label: "FAILED-TO-PIN", basis: representativeness, denominator };
}

export function buildVocabularyReport(
  sample: readonly ObservedEvent[],
  rows: readonly VocabularyRow[],
  rules: RepresentativenessRules,
): VocabularyReport {
  const histogram = buildEventNameHistogram(sample);

  const representativeness = judgeRepresentativeness(sample, rules);

  return {
    probe: "t1-event-vocabulary",
    rulesVersion: rules.version,
    histogram,
    representativeness,
    verdicts: rows.map((row) => verdictForRow(row, histogram, representativeness)),
  };
}

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
