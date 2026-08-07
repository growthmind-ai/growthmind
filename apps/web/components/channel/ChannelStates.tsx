import { Box, Group, Stack, Text } from "@mantine/core";

import { ButtonLink, AnchorLink } from "@/components/ui/Links";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { tapTargetStyle } from "@/components/ui/tap-target";
import { ROUTES } from "@/lib/routes";

import classes from "./channel.module.css";
import type { ConnectionState } from "./view";

// Settings is the one door: it carries the connect form, the channel picker and the move
// control, so every repair on this page points at the same place.
const REPAIR = ROUTES.settings;

export function ConnectionBanner({ connection }: { readonly connection: ConnectionState }) {
  if (connection.kind === "delivering" || connection.kind === "never_connected") {
    return null;
  }

  const disconnected = connection.kind === "disconnected";

  return (
    <SurfaceCard className={classes.banner}>
      <Group gap="md" align="flex-start" wrap="wrap" justify="space-between">
        <Text size="sm" style={{ flex: 1, minWidth: 240 }}>
          <Text span fw={700} inherit>
            {disconnected
              ? "Slack is disconnected. "
              : "Slack is connected, but no channel has been chosen. "}
          </Text>
          {disconnected
            ? "Everything below reached your team before that. Nothing new can arrive until someone reconnects it."
            : "We have somewhere to send from and nowhere to send to. Nothing will arrive until a channel is picked."}
        </Text>

        <AnchorLink href={REPAIR} size="sm" fw={600} style={tapTargetStyle}>
          {disconnected ? "Reconnect Slack →" : "Choose a channel →"}
        </AnchorLink>
      </Group>
    </SurfaceCard>
  );
}

// Every arm names what produces the first message and says out loud that the payoff arrives
// in Slack rather than here — the opposite of an empty state that invites you back.
export function EmptyRecord({ connection }: { readonly connection: ConnectionState }) {
  if (connection.kind === "delivering") {
    return (
      <SurfaceCard>
        <Stack gap="xs">
          <Text fw={600}>Nothing has arrived yet — that is expected</Text>
          <Text size="sm" c="dimmed">
            We are reading your sessions. The first thing solid enough to stand behind goes to{" "}
            {connection.channel}, not here. You will not need to come back to this page to know.
          </Text>
        </Stack>
      </SurfaceCard>
    );
  }

  if (connection.kind === "no_channel") {
    return (
      <SurfaceCard>
        <Stack gap="xs">
          <Text fw={600}>Nothing delivered yet</Text>
          <Text size="sm" c="dimmed">
            Whatever we find goes out as soon as there is a channel to send it to. Picking one is
            the only thing left.
          </Text>
        </Stack>
      </SurfaceCard>
    );
  }

  // The only filled button on this page. Everywhere else the primary action is somewhere
  // else on purpose: a page whose job is proof should not grow calls to action.
  return (
    <SurfaceCard>
      <Stack gap="xs" align="flex-start">
        <Text fw={600}>Nothing has been delivered, because there is nowhere to deliver it</Text>
        <Text size="sm" c="dimmed">
          Findings go to a Slack channel your team already reads. Connect one and this page starts
          filling itself in.
        </Text>
        <Box mt="xs">
          <ButtonLink href={REPAIR} size="md" style={tapTargetStyle}>
            Connect Slack
          </ButtonLink>
        </Box>
      </Stack>
    </SurfaceCard>
  );
}
