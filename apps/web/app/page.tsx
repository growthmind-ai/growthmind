import { Box, Container, Group, Stack, Text } from "@mantine/core";
import { redirect } from "next/navigation";

import { createFirstRunRepo } from "@growthmind/db";
import { SET_UP_CTA_LABEL } from "@growthmind/shared";

import { SettledPanel } from "../components/landing/settled-panel";
import { SignOutButton } from "../components/landing/sign-out-button";
import { WorkspaceName } from "../components/landing/workspace-name";

import { AnchorLink, ButtonLink } from "../components/ui/Links";
import { LogoMark, LogoWordmark } from "../components/ui/Logo";
import { tapTargetStyle } from "../components/ui/tap-target";
import { getDb } from "../lib/db";
import { readLandingView } from "../lib/landing/view";
import { ROUTES } from "../lib/routes";
import { getTenantContext } from "../lib/tenant";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantContext = await getTenantContext();

  if (!tenantContext) {
    redirect(ROUTES.signIn);
  }

  const db = getDb();
  const dismissed = await createFirstRunRepo(db, tenantContext).isDismissed(tenantContext.userId);

  // Only after setup: before it, the button is the one next action and a count of nothing
  // competes with it. One read produces the liveness sentence, the delivery sentence and
  // the fault, so the page cannot report a healthy summary and a fault from two reads that
  // disagree.
  const view = dismissed
    ? await readLandingView({ db, ctx: tenantContext, nowMs: Date.now() })
    : null;

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

          {/* Honesty rule (UX §3, binding). The CTA is built, so it is a real button; the
              rule still governs the stubs on the setup surface, which render no control at
              all (FR-O2, FR-O3, FR-O15). "Your workspace is ready" claims only what ships —
              there is no way to add a teammate, and one added through the API resolves into
              their own workspace (B-001).

              The dismissal is the gate, and it stays the second half of "never linkable back
              to" (FR-O21): a settled founder is offered no way into setup. What changed is
              where they go instead — setup retired holding seven decisions, and the page it
              retired into offered one. */}
          {dismissed ? (
            <SettledPanel view={view} />
          ) : (
            <Stack gap="md">
              <Group wrap="nowrap" align="flex-start" gap="sm">
                <Text c="band.4" fw={700} style={{ width: 20, flexShrink: 0 }} aria-hidden>
                  ✓
                </Text>
                <Text>Your workspace is ready.</Text>
              </Group>

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
            </Stack>
          )}
        </Stack>
      </Container>
    </>
  );
}
