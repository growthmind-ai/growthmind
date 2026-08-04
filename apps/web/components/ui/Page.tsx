import { Box, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import classes from "./surface.module.css";

interface PageHeaderProps {
  readonly title: ReactNode;
  readonly children?: ReactNode;
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <Stack gap={2}>
      <Title order={1} size="h3">
        {title}
      </Title>
      {children === undefined ? null : (
        <Text size="sm" c="dimmed">
          {children}
        </Text>
      )}
    </Stack>
  );
}

export function SectionHeading({ title, children }: PageHeaderProps) {
  return (
    <Stack gap={2}>
      <Title order={2} size="h5">
        {title}
      </Title>
      {children === undefined ? null : (
        <Text size="sm" c="dimmed">
          {children}
        </Text>
      )}
    </Stack>
  );
}

/** The page's last word, set below a rule so it reads as an aside rather than a step. */
export function ClosingNote({ children }: { readonly children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed" pt="sm" className={classes.closing}>
      {children}
    </Text>
  );
}

interface RuledRowProps {
  readonly lead: ReactNode;
  readonly leadWidth?: number;
  readonly children: ReactNode;
}

export function RuledRow({ lead, leadWidth, children }: RuledRowProps) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="md" py="xs" className={classes.ruled}>
      <Box style={{ width: leadWidth, flexShrink: 0 }}>{lead}</Box>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </Group>
  );
}
