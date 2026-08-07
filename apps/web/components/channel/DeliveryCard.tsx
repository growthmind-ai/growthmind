import { Box, Collapse, Group, Paper, Stack, Text } from "@mantine/core";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { AnchorLink } from "@/components/ui/Links";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

import classes from "./channel.module.css";
import { MessageBody } from "./MessageBody";
import type { CardTone, DeliveryCardView, Dot } from "./view";

const DOT_COLOR: Record<Dot, string> = {
  ok: "band.4",
  run: "band.2",
  hold: "stamp.4",
  err: "red.7",
};

const WHY_BACKGROUND: Record<CardTone, { readonly bg?: string }> = {
  plain: {},
  failed: { bg: "var(--mantine-color-red-light)" },
  held: { bg: "var(--mantine-color-stamp-light)" },
};

// The receipt grows the card downwards rather than floating over it: a proof that can be
// open with its message scrolled away, and that vanishes when you look elsewhere, is not
// a proof anyone can screenshot.
const PANEL_MS = 260;
const PANEL_EASING = "cubic-bezier(0.22, 0.7, 0.24, 1)";

interface DeliveryCardProps {
  readonly card: DeliveryCardView;
  readonly open: boolean;
  readonly onToggle: () => void;
}

export function DeliveryCard({ card, open, onToggle }: DeliveryCardProps) {
  const panelId = `receipt-${card.id}`;

  return (
    <Paper withBorder radius="sm" className={classes.card} data-tone={card.tone} id={card.id}>
      <Box p="md" className={card.dimmed ? classes.dimmed : undefined}>
        <Group gap="xs" mb="xs" wrap="wrap">
          <Text size="sm" fw={700}>
            Growthmind
          </Text>
          <Text size="xs" c="dimmed">
            {card.sentAt}
          </Text>
          <Text size="xs" c="dimmed" ff="monospace" ml="auto">
            {card.channelNote}
          </Text>
        </Group>

        <MessageBody body={card.body} />

        <Box mt="sm">
          <AnchorLink href={card.findingHref} size="sm" fw={600}>
            See the evidence →
          </AnchorLink>
        </Box>
      </Box>

      <button
        type="button"
        className={classes.strip}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <Box
          className={`${classes.dot} ${card.dot === "run" ? classes.pulse : ""}`}
          bg={DOT_COLOR[card.dot]}
        />
        <Text
          component="span"
          size="xs"
          className={classes.stripText}
          {...(card.dot === "err" ? { c: "red.6", fw: 600 } : {})}
        >
          {card.strip}
        </Text>
        <Text component="span" size="xs" className={classes.chevron} aria-hidden>
          ▾
        </Text>
      </button>

      <Collapse
        expanded={open}
        transitionDuration={PANEL_MS}
        transitionTimingFunction={PANEL_EASING}
      >
        <Box
          id={panelId}
          p="md"
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          <Eyebrow mb="xs">Delivery receipt</Eyebrow>

          <Stack gap={8} mb="sm">
            {card.receipt.map((row) => (
              <Group key={row.text} gap="sm" align="flex-start" wrap="nowrap">
                <Box className={classes.pip} c={DOT_COLOR[row.pip]} />
                <Text size="sm">
                  {row.text}
                  {row.detail === null ? null : (
                    <Text span size="xs" c="dimmed">
                      {" — "}
                      {row.detail}
                    </Text>
                  )}
                </Text>
              </Group>
            ))}
          </Stack>

          <SurfaceCard {...WHY_BACKGROUND[card.tone]}>
            <Text size="sm">{card.why}</Text>
          </SurfaceCard>

          {card.repair === null ? null : (
            <Box mt="sm">
              {card.repair.kind === "link" ? (
                <AnchorLink href={card.repair.href} size="sm" fw={600}>
                  {card.repair.label}
                </AnchorLink>
              ) : (
                <Text size="sm" c="dimmed">
                  {card.repair.text}
                </Text>
              )}
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
