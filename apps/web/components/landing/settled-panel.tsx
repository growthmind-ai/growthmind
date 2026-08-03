import { Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { SETTINGS_TITLE } from "@growthmind/shared";

import { AnchorLink } from "../ui/Links";
import { ROUTES } from "../../lib/routes";

const BULLET_WIDTH = { width: 20, flexShrink: 0 };

function Row({ children }: { children: ReactNode }) {
  return (
    <Group wrap="nowrap" align="flex-start" gap="sm">
      <Text c="dimmed" fw={700} style={BULLET_WIDTH} aria-hidden>
        ·
      </Text>
      {children}
    </Group>
  );
}

interface SettledPanelProps {
  // Both null when the read failed: this panel is the extra, never the page's job.
  readonly liveness: string | null;
  readonly settled: string | null;
}

// What a founder sees once setup has retired. The settled line names a missing
// Slack channel for anyone who skipped it, and the link is the control behind
// that sentence — setup is gone by then, and nothing else led anywhere (B-035).
export function SettledPanel(props: SettledPanelProps) {
  return (
    <>
      {props.liveness === null ? null : (
        <Row>
          <Text>{props.liveness}</Text>
        </Row>
      )}

      {props.settled === null ? null : (
        <Row>
          <Text c="dimmed">{props.settled}</Text>
        </Row>
      )}

      <Row>
        <AnchorLink href={ROUTES.settings}>{SETTINGS_TITLE}</AnchorLink>
      </Row>
    </>
  );
}
