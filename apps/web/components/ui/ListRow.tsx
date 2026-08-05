import { Box, Text } from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";

import classes from "@/components/preview/preview.module.css";

interface ListRowProps {
  readonly href: string;

  // The leading stat differs per list (a count, a check tally, an outcome word) and stays
  // caller-supplied rather than standardized, so each page keeps its own emphasis.
  readonly leading: ReactNode;

  // Named `heading`/`detail` rather than `title`/`subtitle`: the latter collides with the
  // HTML `title` attribute the replay-attribute-exposure scan tracks, even though this one
  // renders as text (which rrweb masks) rather than an attribute (which it cannot).
  readonly heading: ReactNode;
  readonly detail: ReactNode;
  readonly trailing: ReactNode;
}

// Shared by the findings, fixes and experiments list pages: a link row with a leading
// stat, a heading/detail column, and a trailing monospace meta column.
export function ListRow({ href, leading, heading, detail, trailing }: ListRowProps) {
  return (
    <Link href={href} className={classes.rowLink}>
      {leading}
      <Box style={{ minWidth: 0 }}>
        <Text fw={600} style={{ lineHeight: 1.4 }}>
          {heading}
        </Text>
        <Text size="sm" c="dimmed" style={{ lineHeight: 1.45 }}>
          {detail}
        </Text>
      </Box>
      <Text ff="monospace" size="xs" c="dimmed">
        {trailing}
      </Text>
    </Link>
  );
}
