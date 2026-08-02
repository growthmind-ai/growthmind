import { Box, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { LogoMark } from "./Logo";
import { Stamp } from "./Stamp";

export function MemoSheet({
  department = "INTEROFFICE · GROWTH DIVISION",
  stamp,
  footnote,
  children,
}: {
  department?: string;

  stamp?: string;

  footnote?: string;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius={0}>
      <Box h={9} bg="band.4" />

      <Box px="lg" pt="md" pb="lg">
        <Group
          gap="sm"
          wrap="nowrap"
          pb="xs"
          justify="space-between"

          style={{ borderBottom: "1.5px solid var(--mantine-color-text)" }}
        >
          <Group gap="sm" wrap="nowrap">
            <LogoMark size={22} />
            <Box>
              <Text fw={800} fz={13.5} lts="0.05em" lh={1.2}>
                GROWTHMIND
              </Text>
              <Text fz={8.5} lts="0.2em" c="dimmed" lh={1.4}>
                {department}
              </Text>
            </Box>
          </Group>

          {/* The stamp is laid out in the letterhead row rather than pinned
              to the sheet's corner: a rotation doesn't affect layout, so it
              still reads as pressed on at an angle, but it can never land on
              top of the memo's text. Absolute positioning here collided with
              the address block as soon as a value wrapped — which is exactly
              what happens at mobile width. */}
          {stamp ? <Stamp>{stamp}</Stamp> : null}
        </Group>

        {children}

        {footnote ? (
          <Text
            ff="var(--mono)"
            fz={8.5}
            lts="0.18em"
            c="dimmed"
            mt="md"
            pt="sm"
            style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
          >
            {footnote}
          </Text>
        ) : null}
      </Box>
    </Paper>
  );
}

export type MemoField = { label: string; value: ReactNode };

export function MemoFields({ fields }: { fields: readonly MemoField[] }) {
  return (
    <Box mt="sm" ff="var(--type)" fz={12} style={{ lineHeight: 1.95 }}>
      {fields.map((field) => (
        <Box key={field.label} style={{ display: "flex" }}>
          <Text component="span" c="dimmed" inherit style={{ flexShrink: 0, width: 46 }}>
            {field.label}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }}>{field.value}</Box>
        </Box>
      ))}
    </Box>
  );
}
