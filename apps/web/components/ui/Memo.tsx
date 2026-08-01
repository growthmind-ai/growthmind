import { Box, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { LogoMark } from "./Logo";
import { Stamp } from "./Stamp";

/**
 * The interoffice memo — the brand's one document object, ported from the
 * marketing site's `MemoCard` so the app and growthmind.ai read as one
 * product. A visitor arriving from the site should not cross a visual cliff
 * at the moment we ask them to commit.
 *
 * `MemoSheet` is the chrome only: the band stripe across the head, the
 * letterhead beneath it, an optional stamp, and the imprint rule that closes
 * the sheet. Whatever the memo is *about* composes as children — so a
 * specimen on the auth pages and (later) a real finding are the same object
 * carrying different content, not two implementations of a memo.
 *
 * Square corners are deliberate and override the theme's default radius: this
 * is a sheet of paper, not a card.
 */
export function MemoSheet({
  department = "INTEROFFICE · GROWTH DIVISION",
  stamp,
  footnote,
  children,
}: {
  department?: string;
  /** Rubber-stamped verdict, set against the letterhead. */
  stamp?: string;
  /** Wide-tracked mono line closing the sheet, above a hairline rule. */
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
          // The letterhead rule is the memo's heaviest line — full-strength
          // ink rather than the default hairline, matching the site.
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

/**
 * The typewriter address block — `TO:` / `FROM:` / `RE:` in a fixed label
 * gutter so the values align down the sheet, the way a typed memo does.
 *
 * Each row is a flex pair rather than an inline-block label followed by inline
 * text: a long `RE:` line wraps at narrow widths, and inline text resumes at
 * the row's left edge, under the label. The flex column keeps the hanging
 * indent so every wrapped line stays in the value column.
 */
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
