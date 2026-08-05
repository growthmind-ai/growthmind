import { Stack, Text } from "@mantine/core";

import type { ObservedFactView } from "@/lib/settings/business";

// No correct-or-remove control, unlike its stated sibling. A person may argue with their own
// copy; what someone did is not theirs to edit. Traffic that was never a real user is
// answered by the exclusion rules further up this page, not by rewriting the observation.
export function ObservedRow({ fact }: { fact: ObservedFactView }) {
  return (
    <Stack gap={0}>
      <Text size="sm">{fact.statement}</Text>
      {fact.evidence === null ? null : (
        <Text size="xs" c="dimmed">
          {fact.evidence}
        </Text>
      )}
    </Stack>
  );
}
