// THE COUNTER, RENDERED — AND NARROWED SO IT CANNOT MAKE A PROMISE
// (O-008, AD-3, FR-O7, UX Checklist rows 9 and 10).
//
// ###########################################################################
// # THE PROPS TYPE IS THE WHOLE ROW.
// #
// # This component takes `OnboardingCounterView` and never the shipped wide
// # counter. The wide one carries a lag estimate whose sentence, on the
// # shipped defaults, names two committed durations — in front of a customer
// # that fails FR-O18 and FR-O22 in one line, on a surface whose binding rule
// # is that no string commits to a duration. Narrowing at the boundary makes
// # rendering one a COMPILE ERROR rather than a discipline somebody has to
// # remember at 2am. Widening this prop is how that protection dies.
// #
// # THE IDENTITY ADDS UP ON SCREEN, NOT JUST ON THE OBJECT:
// # total = kept + Σ set aside + could-not-be-read. Every term is its own
// # visible row, because a founder checking our arithmetic checks the numbers
// # they can see.
// #
// # `keptIdentityUnverified` GETS ITS OWN ROW AND IS NEVER INDENTED UNDER THE
// # SET-ASIDE BREAKDOWN. It was KEPT — we simply could not check who it was.
// # Filing it under "set aside" would say the opposite, and folding it into
// # "counted as real people" would launder it, which is the exact move FR-O7
// # exists to forbid.
// ###########################################################################
import { SimpleGrid, Stack, Text } from "@mantine/core";
import { Fragment } from "react";

import { COUNTER_LABELS, type CounterRow, type OnboardingCounterView } from "@growthmind/shared";

/** Digits that do not reflow as they change (T5 — never a rolling odometer). */
const TABULAR = { fontVariantNumeric: "tabular-nums" };

interface CounterLineProps {
  readonly row: CounterRow;
  /** The set-aside breakdown, one indent under its own aggregate. */
  readonly indent?: boolean;
}

/**
 * One label beside one number.
 *
 * Two columns on a pointer-sized screen, label-above-value on a phone. Long
 * labels WRAP and never truncate: truncating the identity row turns it into
 * "Counted", which is the laundering this whole block is written to prevent.
 */
function CounterLine({ row, indent }: CounterLineProps) {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" verticalSpacing={0}>
      <Text size="sm" c="dimmed" pl={indent === true ? "md" : 0}>
        {row.label}
      </Text>
      <Text size="sm" ta={{ base: "left", xs: "right" }} style={TABULAR}>
        {row.value}
      </Text>
    </SimpleGrid>
  );
}

interface CounterGridProps {
  readonly view: OnboardingCounterView;
}

export function CounterGrid({ view }: CounterGridProps) {
  return (
    <Stack gap={6}>
      {view.rows.map((row) => (
        <Fragment key={row.label}>
          <CounterLine row={row} />
          {/* The breakdown belongs UNDER its own aggregate, and the aggregate is
              found by its shipped label rather than by its position in the
              array — a positional index is a silent mis-nesting the first time
              a row is added. The identity row follows at the top level. */}
          {row.label === COUNTER_LABELS.setAside ? (
            <>
              {view.setAside.map((entry) => (
                <CounterLine key={entry.label} row={entry} indent />
              ))}
              <CounterLine row={view.identityUnverified} />
            </>
          ) : null}
        </Fragment>
      ))}
      <Text size="xs" c="dimmed">
        {view.asOfStatement}
      </Text>
      <Text size="xs" c="dimmed">
        {view.windowStatement}
      </Text>
      <Text size="xs" c="dimmed">
        {view.completenessStatement}
      </Text>
    </Stack>
  );
}
