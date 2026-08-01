// THE COUNTER, NARROWED SO IT CANNOT MAKE A PROMISE (O-008, AD-3, FR-O7).
//
// ###########################################################################
// # WHAT AD-3 IS ACTUALLY BUYING.
// #
// # `EventsSeenCounter.expectedLag` is a real, correct, shipped contract with
// # one producer and three test consumers. IT IS NOT DELETED. It is simply not
// # a property in scope inside any component on this surface — so rendering a
// # duration promise is a COMPILE ERROR rather than a discipline somebody has
// # to remember at 2am.
// #
// # That is not hypothetical. `describeExpectedLag` computes
// # `pollIntervalSeconds + 25` and `+ 220`; with the shipped column default of
// # 60 the statement on the input names EIGHTY-FIVE AND TWO HUNDRED AND EIGHTY
// # SECONDS. In front of a customer that fails FR-O18 and FR-O22 in one line.
// #
// # NARROW AT THE BOUNDARY, DO NOT AMPUTATE — the same move
// # `findings.repo.ts:86-92` makes, for the same reason: the consumer should
// # not be able to REACH the thing it must not use.
// ###########################################################################
//
// ── EVERY STRING ON THIS VIEW COMES FROM A SHIPPED TABLE ────────────────────
//
// The labels, the two statements and the set-aside names are read from
// `COUNTER_LABELS`, `COUNTER_WINDOW_STATEMENT`, `COUNTER_COMPLETENESS_STATEMENT`
// and `EXCLUSION_REASON_LABELS` — never off the input object, even where the
// input carries a field of the same name. Two reasons, and both are load
// bearing:
//
//   - B3. The one home for copy is the table, and a view that forwards a
//     persisted sentence renders whatever the producer authored, which is a
//     second home nobody audits.
//   - D5. Prod contains every shape ever written. A label persisted before a
//     rewording is a stale sentence the plain-English audit never sees.
//
// The ONLY string this file composes is the as-of date, and the format is the
// subject of the note on `formatAsOf`.

import type { EventsSeenCounter } from "../counter/types";
import {
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_LABELS,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
} from "../session-source/messages";
import { COUNTER_AS_OF_NEVER, COUNTER_AS_OF_TEMPLATE } from "./messages";
import type { CounterRow, OnboardingCounterView } from "./types";

/**
 * DECLARED IN `./types`, RE-EXPORTED HERE.
 *
 * `FirstRunStatus` carries the narrowed counter, so the type has to sit where
 * nothing imports back into this file — see the settlement note in `types.ts`.
 * The re-export means a consumer reaching for the view model and its shapes
 * still has one import, and there is exactly one declaration of each.
 */
export type { CounterRow, OnboardingCounterView } from "./types";

/**
 * The months, written out.
 *
 * `Intl.DateTimeFormat` is deliberately not used: its output moves with the ICU
 * version bundled by the runtime, so the one string this file composes would be
 * a moving target across environments and a moving target in tests.
 */
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

/**
 * WHEN THE LAST SUCCESSFUL CHECK COMPLETED, AS A POINT IN TIME AND NEVER AS A
 * LENGTH OF ONE.
 *
 * "5 minutes ago" is the obvious format and it is the one thing this file may
 * not produce: a relative stamp puts a committed duration on the screen through
 * the back door, which is precisely what AD-3 spent a whole narrowing type to
 * keep off it. An absolute calendar stamp cannot be read as a promise about how
 * long anything takes, because it is not about elapsing at all.
 *
 * UTC is named rather than assumed. This is a pure function in
 * `packages/shared` with no viewer to ask, and a bare "10:00" would be a
 * different lie — a time in nobody's timezone, presented as if it were theirs.
 */
function formatAsOf(when: Date): string {
  const date = `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
  const clock = `${twoDigits(when.getUTCHours())}:${twoDigits(when.getUTCMinutes())}`;

  return `${date} at ${clock} UTC`;
}

/**
 * The freshness line.
 *
 * A NULL `asOf` IS A FACT, NOT A FORMATTING OF NOTHING. It is never blank —
 * blank reads as "nothing to say", which on a counter is alarming — and it is
 * never "now", which would claim a check that has not happened.
 */
function asOfStatementFor(asOf: Date | null): string {
  return asOf === null
    ? COUNTER_AS_OF_NEVER
    : COUNTER_AS_OF_TEMPLATE.replaceAll("{when}", formatAsOf(asOf));
}

/**
 * The counter, narrowed to what the screen renders.
 *
 * THE TYPE IS WRITTEN BY EXPLICIT FIELD ENUMERATION (in `./types`), NEVER
 * `Omit<EventsSeenCounter, "expectedLag">`. An `Omit` silently re-admits the
 * NEXT duration-bearing field somebody adds to the shipped counter; the
 * enumeration refuses it by default and forces the addition to be a deliberate
 * edit somebody has to justify.
 *
 * THE IDENTITY IS TRUE ON SCREEN, not merely on the object behind it:
 * `totalReceived = kept + Σ setAside + droppedUnreadable`, with every term
 * rendered as its own row. A founder checking our arithmetic checks the numbers
 * they can see.
 */
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
      // THE AGGREGATE RENDERS EVEN WHEN THE BREAKDOWN IS EMPTY, carrying 0. An
      // omitted row reads as "this does not apply to you"; a zero reads as "we
      // checked, and it was none" — and only one of those is true.
      { label: COUNTER_LABELS.setAside, value: setAsideTotal },
      { label: COUNTER_LABELS.droppedUnreadable, value: counter.droppedUnreadable },
    ],
    setAside,
    // ITS OWN ROW, NEVER FOLDED INTO `kept`. Summing them would launder "we
    // could not check who they were" into "counted as real people".
    identityUnverified: {
      label: COUNTER_LABELS.keptIdentityUnverified,
      value: counter.keptIdentityUnverified,
    },
    asOfStatement: asOfStatementFor(counter.asOf),
    windowStatement: COUNTER_WINDOW_STATEMENT,
    completenessStatement: COUNTER_COMPLETENESS_STATEMENT,
  };
}
