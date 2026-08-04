import { Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { ONBOARDING_MESSAGES, SETTINGS_TITLE } from "@growthmind/shared";

import type { LandingView } from "../../lib/landing/view";
import { ROUTES } from "../../lib/routes";
import { ButtonLink } from "../ui/Links";
import { tapTargetStyle } from "../ui/tap-target";

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

// What a founder is told when nothing needs them. The last line is §10 said out loud: this
// surface is not one to keep an eye on, and promising that is the point of keeping it thin.
// Gated on `liveness`, because that sentence IS the evidence — "Growthmind is running" over
// a counter nobody could read is a claim with nothing behind it.
function Running({ liveness, deliveryLine }: { liveness: string; deliveryLine: string | null }) {
  return (
    <>
      <Row>
        <Text>{ONBOARDING_MESSAGES.landingRunning}</Text>
      </Row>

      <Row>
        <Text c="dimmed">{liveness}</Text>
      </Row>

      {deliveryLine === null ? null : (
        <Row>
          <Text c="dimmed">{deliveryLine}</Text>
        </Row>
      )}

      <Row>
        <Text size="sm" c="dimmed">
          {ONBOARDING_MESSAGES.landingNothingToCheck}
        </Text>
      </Row>
    </>
  );
}

interface SettledPanelProps {
  // `null` when every read failed. The door still renders — it is the way to the controls
  // that repair whatever failed, so it is the one thing that must not depend on a read.
  readonly view: LandingView | null;
}

export function SettledPanel({ view }: SettledPanelProps) {
  return (
    <Stack gap="md">
      {/* The fault REPLACES the summary rather than sitting beside it. Reporting "we could
          not reach your analytics" under "236 of 236 events counted" is the shape that
          makes a founder trust neither sentence. */}
      {view?.attention != null ? (
        <Paper withBorder radius="md" p="md">
          <Stack gap={6}>
            <Text fw={600}>{view.attention.headline}</Text>
            <Text size="sm" c="dimmed">
              {view.attention.detail}
            </Text>
            <Text size="sm">{view.attention.action}</Text>
          </Stack>
        </Paper>
      ) : null}

      {view?.attention == null && view?.liveness != null ? (
        <Running liveness={view.liveness} deliveryLine={view.deliveryLine} />
      ) : null}

      {/* The one door, at primary weight and full width on a phone. It was a text link,
          which is how seven configured things came to look like none. */}
      <ButtonLink
        href={ROUTES.settings}
        size="md"
        style={tapTargetStyle}
        w={{ base: "100%", xs: "auto" }}
      >
        {SETTINGS_TITLE}
      </ButtonLink>
    </Stack>
  );
}
