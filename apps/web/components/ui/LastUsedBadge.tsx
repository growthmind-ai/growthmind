import { Badge, Box, rem } from "@mantine/core";
import type { ReactNode } from "react";

export const LAST_USED_LABEL = "Last used";

interface LastUsedBadgeProps {
  readonly children: ReactNode;
  readonly badgeId: string;
  readonly lastUsed: boolean;
}

// Sits inside the control's top-right corner rather than over its edge: the sign-in
// buttons are 8px apart, and a badge that overhangs lands on the button above it.
export function LastUsedBadge({ children, badgeId, lastUsed }: LastUsedBadgeProps) {
  return (
    <Box pos="relative">
      {children}
      {lastUsed ? (
        <Badge
          id={badgeId}
          size="xs"
          variant="default"
          pos="absolute"
          top={rem(4)}
          right={rem(4)}
          style={{ pointerEvents: "none" }}
        >
          {LAST_USED_LABEL}
        </Badge>
      ) : null}
    </Box>
  );
}
