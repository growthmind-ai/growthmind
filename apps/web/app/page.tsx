import { Anchor, Box, Container, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "../components/landing/sign-out-button";
import { WorkspaceName } from "../components/landing/workspace-name";
import { LogoMark, LogoWordmark } from "../components/ui/Logo";
import { ROUTES } from "../lib/routes";
import { getTenantContext } from "../lib/tenant";

// Server component by convention — client logic lives in separate
// "use client" components (see AGENTS.md). This is the authenticated
// workspace landing (ADD D-G/D-H): a signed-out visitor is redirected to
// `/sign-in` before anything renders, so there is no client loading flash
// and no separate "no data" state — the landing IS the empty state.
export default async function HomePage() {
  const tenantContext = await getTenantContext();

  if (!tenantContext) {
    redirect(ROUTES.signIn);
  }

  return (
    <>
      <Box
        component="header"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Container size="sm">
          <Group justify="space-between" wrap="nowrap" py="sm">
            <Anchor component={Link} href={ROUTES.home} underline="never" c="inherit">
              <Group gap="xs" wrap="nowrap">
                <LogoMark size={28} />
                <LogoWordmark size={16} />
              </Group>
            </Anchor>
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

            {/* Honesty rule (UX §3, binding): plain text, not a button or
                link — nothing unbuilt is clickable. Becomes the CTA in
                O-003. */}
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <Text c="band.4" fw={700} style={{ width: 20, flexShrink: 0 }} aria-hidden>
                →
              </Text>
              <Text>
                Next: connect your site so Growthmind can watch real sessions — that&apos;s the next
                release step.
              </Text>
            </Group>

            <Group wrap="nowrap" align="flex-start" gap="sm">
              <Text c="dimmed" fw={700} style={{ width: 20, flexShrink: 0 }} aria-hidden>
                ·
              </Text>
              <Text c="dimmed">
                Then: findings arrive in your Slack, with the evidence attached.
              </Text>
            </Group>
          </Stack>
        </Stack>
      </Container>
    </>
  );
}
