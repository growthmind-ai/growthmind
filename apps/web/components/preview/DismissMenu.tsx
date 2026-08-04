"use client";

import { Button, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";

import { dismissFindingAction } from "@/lib/preview/actions";
import { tapTargetStyle } from "@/components/ui/tap-target";

// A closed set. A free-text reason cannot be counted across customers, and it does not get
// written — one tap does.
const REASONS = [
  "We already knew",
  "Real, but we won't fix it",
  "That's meant to happen",
  "Your explanation was wrong",
  "Wrong people, wrong place",
  "True, but too small",
] as const;

export function DismissMenu({ id }: { readonly id: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="default"
        size="compact-sm"
        style={tapTargetStyle}
        onClick={() => setOpen(true)}
      >
        Not useful
      </Button>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        What was wrong with it? This changes what we rank next.
      </Text>
      <Group gap="xs">
        {REASONS.map((reason) => (
          <form key={reason} action={dismissFindingAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="reason" value={reason} />
            <Button type="submit" variant="default" size="compact-sm" style={tapTargetStyle}>
              {reason}
            </Button>
          </form>
        ))}
        <Button
          variant="subtle"
          size="compact-sm"
          style={tapTargetStyle}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
