"use client";

import { Box, Collapse, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useId, useState } from "react";

import { AnchorLink } from "@/components/ui/Links";
import { UNROLED_ACTION, type FixRowView } from "@/lib/fixes/view";
import { ROUTES } from "@/lib/routes";

import classes from "./fixes.module.css";

const OPEN_MS = 280;

const EASE = "cubic-bezier(.22,.7,.24,1)";

// One panel at a time: the panel compares this row against its neighbours, and two open
// comparisons are two claims about one order.
export function FixRows({ rows }: { readonly rows: readonly FixRowView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const base = useId();

  return (
    <Stack
      gap="xs"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpenId(null);
      }}
    >
      {rows.map((row) => {
        const open = openId === row.fixId;
        const panelId = `${base}-${row.fixId}`;

        return (
          <Paper
            key={row.fixId}
            withBorder
            radius="sm"
            className={[classes.row, row.due.late ? classes.late : null].filter(Boolean).join(" ")}
          >
            <Box className={classes.head}>
              <UnstyledButton
                className={classes.why}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => {
                  setOpenId(open ? null : row.fixId);
                }}
              >
                <Text component="span" className={classes.rank} ff="monospace" fw={700} fz={12}>
                  {row.rank}
                </Text>
                <Text
                  component="span"
                  className={classes.whyLabel}
                  fz={9}
                  c="dimmed"
                  tt="uppercase"
                >
                  why
                </Text>
              </UnstyledButton>

              <Box style={{ minWidth: 0 }}>
                <AnchorLink href={row.href} className={classes.title} fw={600}>
                  {row.summary}
                </AnchorLink>
                <Text size="sm" c="dimmed" style={{ lineHeight: 1.45 }}>
                  <Text span ff="monospace" size="sm" c="dimmed">
                    {row.count}
                  </Text>
                  {` · ${row.why.roleNote}`}
                </Text>
              </Box>

              <Box className={classes.trailing}>
                <Text
                  ff="monospace"
                  size="xs"
                  c={row.due.late ? "stamp.4" : "dimmed"}
                  fw={row.due.late ? 700 : 400}
                >
                  {row.due.value}
                </Text>
                <Text size="xs" c="dimmed">
                  {row.due.label}
                </Text>
              </Box>
            </Box>

            <Collapse
              expanded={open}
              id={panelId}
              transitionDuration={reduced === true ? 0 : OPEN_MS}
              transitionTimingFunction={EASE}
            >
              <Box className={classes.panel}>
                <Text size="sm">{row.why.lead}</Text>
                <Text size="sm" c="dimmed">
                  {row.why.roleNote}
                </Text>
                <Text ff="monospace" size="xs" c="dimmed" mt={8}>
                  {row.why.arithmetic}
                </Text>
                {row.why.against === null ? null : (
                  <Text size="sm" c="dimmed" mt={8}>
                    {row.why.against}
                  </Text>
                )}
                {row.why.unroled ? (
                  <Text size="sm" mt={8}>
                    {`${UNROLED_ACTION} `}
                    <AnchorLink href={ROUTES.settings} size="sm">
                      Say what your pages are for
                    </AnchorLink>
                  </Text>
                ) : null}
              </Box>
            </Collapse>
          </Paper>
        );
      })}
    </Stack>
  );
}
