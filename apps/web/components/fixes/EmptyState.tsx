import { Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";

import classes from "./fixes.module.css";

interface EmptyStateProps {
  readonly heading: string;
  readonly href: string;
  readonly action: string;
  readonly children: ReactNode;
}

// Every state this page can end in names one next action, so none of them is a dead end.
export function EmptyState({ heading, href, action, children }: EmptyStateProps) {
  return (
    <Paper withBorder radius="sm" p="xl" className={classes.empty}>
      <Stack gap="sm" align="center">
        <Text fw={700}>{heading}</Text>
        <Text size="sm" c="dimmed" ta="center" maw="56ch">
          {children}
        </Text>
        <ButtonLink href={href} variant="default" size="compact-sm" style={tapTargetStyle}>
          {action}
        </ButtonLink>
      </Stack>
    </Paper>
  );
}
