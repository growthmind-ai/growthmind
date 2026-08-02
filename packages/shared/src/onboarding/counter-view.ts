import type { EventsSeenCounter } from "../counter/types";
import {
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_LABELS,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
} from "../session-source/messages";
import { COUNTER_AS_OF_NEVER, COUNTER_AS_OF_TEMPLATE } from "./messages";
import type { CounterRow, OnboardingCounterView } from "./types";

export type { CounterRow, OnboardingCounterView } from "./types";

const MONTHS: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const twoDigits = (value: number): string => String(value).padStart(2, "0");

function formatAsOf(when: Date): string {
  const date = `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
  const clock = `${twoDigits(when.getUTCHours())}:${twoDigits(when.getUTCMinutes())}`;

  return `${date} at ${clock} UTC`;
}

function asOfStatementFor(asOf: Date | null): string {
  return asOf === null
    ? COUNTER_AS_OF_NEVER
    : COUNTER_AS_OF_TEMPLATE.replaceAll("{when}", formatAsOf(asOf));
}

export function toOnboardingCounterView(counter: EventsSeenCounter): OnboardingCounterView {
  const setAside: readonly CounterRow[] = counter.setAside.map((entry) => ({
    label: EXCLUSION_REASON_LABELS[entry.reason],
    value: entry.count,
  }));

  const setAsideTotal = counter.setAside.reduce((sum, entry) => sum + entry.count, 0);

  return {
    state: counter.state,
    rows: [
      { label: COUNTER_LABELS.totalReceived, value: counter.totalReceived },
      { label: COUNTER_LABELS.kept, value: counter.kept },

      { label: COUNTER_LABELS.setAside, value: setAsideTotal },
      { label: COUNTER_LABELS.droppedUnreadable, value: counter.droppedUnreadable },
    ],
    setAside,

    identityUnverified: {
      label: COUNTER_LABELS.keptIdentityUnverified,
      value: counter.keptIdentityUnverified,
    },
    asOfStatement: asOfStatementFor(counter.asOf),
    windowStatement: COUNTER_WINDOW_STATEMENT,
    completenessStatement: COUNTER_COMPLETENESS_STATEMENT,
  };
}
