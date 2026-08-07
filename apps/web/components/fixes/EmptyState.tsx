import { Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";

import classes from "./fixes.module.css";

interface EmptyStateProps {
  readonly heading: string;

  // Omitted together for a read that failed: the next step there is to wait a minute, which
  // the body says. A control that repairs a fault we have not established is worse than none.
  readonly href?: string | undefined;
  readonly action?: string | undefined;
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
        {href === undefined || action === undefined ? null : (
          <ButtonLink href={href} variant="default" size="compact-sm" style={tapTargetStyle}>
            {action}
          </ButtonLink>
        )}
      </Stack>
    </Paper>
  );
}
