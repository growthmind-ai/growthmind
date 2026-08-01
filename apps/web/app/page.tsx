import { Box, Container, Group, Stack, Text } from "@mantine/core";
import { redirect } from "next/navigation";

import { createFirstRunRepo } from "@growthmind/db";
import { LANDING_SETTLED_LINE, SET_UP_CTA_LABEL } from "@growthmind/shared";

import { SignOutButton } from "../components/landing/sign-out-button";
import { WorkspaceName } from "../components/landing/workspace-name";
// Mantine link/button primitives that are safe to compose from a SERVER component.
// `component={Link}` written inline here passes a function across the server→client
// boundary and 500s the route — see the header on Links.tsx.
import { AnchorLink, ButtonLink } from "../components/ui/Links";
import { LogoMark, LogoWordmark } from "../components/ui/Logo";
import { tapTargetStyle } from "../components/ui/tap-target";
import { getDb } from "../lib/db";
import { ROUTES } from "../lib/routes";
import { getTenantContext } from "../lib/tenant";

// Server component by convention. Client logic lives in separate "use client"
// components (see agents.md). This is the authenticated workspace landing: a signed-out
// visitor is redirected to `/sign-in` before anything renders, so there is no client
// loading flash and no separate "no data" state. The landing IS the empty state.
export default async function HomePage() {
  const tenantContext = await getTenantContext();

  if (!tenantContext) {
    redirect(ROUTES.signIn);
  }

  // Per-user, never per-org (O-008 AD-17): a teammate who set nothing up still
  // gets their own first run, which is the only place this release lets them
  // read the workspace's connection state and disconnect it.
  const dismissed = await createFirstRunRepo(getDb(), tenantContext).isDismissed(
    tenantContext.userId,
  );

  return (
    <>
      <Box
        component="header"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Container size="sm">
          <Group justify="space-between" wrap="nowrap" py="sm">
            <AnchorLink href={ROUTES.home} underline="never" c="inherit">
              <Group gap="xs" wrap="nowrap">
                <LogoMark size={28} />
                <LogoWordmark size={16} />
              </Group>
            </AnchorLink>
            <SignOutButton />
          </Group>
        </Container>
      </Box>

      <Container size="sm" py="xl">
        <Stack gap="xl">
          {/* Workspace name lives here only — not duplicated in the header
              (single locus; revisit when a second page exists). P1 rename
              (UX §5) is the client island; everything else on this page
              stays a server component. */}
          <WorkspaceName initialName={tenantContext.organizationName} />

          <Stack gap="md">
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <Text c="band.4" fw={700} style={{ width: 20, flexShrink: 0 }} aria-hidden>
                ✓
              </Text>
              {/* Honesty rule (UX §3): this claimed teammates "see the same
                  thing here", which is not true yet — there is no way to add
                  a teammate through the product, and the O-002 edge sweep
                  proved that a teammate added through the API resolves into
                  their OWN auto-created workspace, not the one they joined
                  (shared/BUGS.md B-001). Claim only what ships. */}
              <Text>Your workspace is ready.</Text>
            </Group>

            {/* Honesty rule (UX §3, binding). This line was plain text — not a
                button, not a link — because nothing unbuilt is clickable, and
                it said so while setup did not exist. THE CTA IS NOW BUILT, so
                it is a real button (FR-O2). The rule itself has not gone
                anywhere: it now governs the two stubs on the setup surface,
                which render no control at all (FR-O3, FR-O15). Update this
                comment when the claim changes; deleting it loses the rule at
                the exact line somebody would break it.

                The gate is the second half of "never linkable back to"
                (FR-O21): once this user has finished setup, `/` offers no way
                back and no link to it exists anywhere in the app. */}
            {dismissed ? (
              <Group wrap="nowrap" align="flex-start" gap="sm">
                <Text c="dimmed" fw={700} style={{ width: 20, flexShrink: 0 }} aria-hidden>
                  ·
                </Text>
                <Text c="dimmed">{LANDING_SETTLED_LINE}</Text>
              </Group>
            ) : (
              <>
                <ButtonLink
                  href={ROUTES.firstRun}
                  size="md"
                  style={tapTargetStyle}
                  w={{ base: "100%", xs: "auto" }}
                >
                  {SET_UP_CTA_LABEL}
                </ButtonLink>

                <Group wrap="nowrap" align="flex-start" gap="sm">
                  <Text c="dimmed" fw={700} style={{ width: 20, flexShrink: 0 }} aria-hidden>
                    ·
                  </Text>
                  <Text c="dimmed">
                    Then: findings arrive in your Slack, with the evidence attached.
                  </Text>
                </Group>
              </>
            )}
          </Stack>
        </Stack>
      </Container>
    </>
  );
}
