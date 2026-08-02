import { SimpleGrid, Stack, Text } from "@mantine/core";
import { Fragment } from "react";

import { COUNTER_LABELS, type CounterRow, type OnboardingCounterView } from "@growthmind/shared";

const TABULAR = { fontVariantNumeric: "tabular-nums" };

interface CounterLineProps {
  readonly row: CounterRow;

  readonly indent?: boolean;
}

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
