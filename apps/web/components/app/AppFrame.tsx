"use client";

import { AppShell, Box, Burger, Container, Group, ScrollArea } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import Link from "next/link";
import type { ReactNode } from "react";

import { Bell } from "@/components/notifications/Bell";
import { BellErrorBoundary } from "@/components/notifications/BellErrorBoundary";
import { LogoMark, LogoWordmark } from "@/components/ui/Logo";
import type { NavGroup } from "@/lib/app-nav";
import type { BellViewModel } from "@/lib/notifications/bell";
import { ROUTES } from "@/lib/routes";

import { AppNav } from "./AppNav";
import { OrgSwitcher, type OrgOption } from "./OrgSwitcher";
import { UserMenu, type Viewer } from "./UserMenu";

import classes from "./app-shell.module.css";

const HAIRLINE = { borderBottom: "1px solid var(--mantine-color-default-border)" };

interface AppFrameProps {
  readonly groups: readonly NavGroup[];
  readonly viewer: Viewer;
  readonly organizations: readonly OrgOption[];
  readonly activeOrganizationId: string;
  readonly role: string;

  // Required rather than optional: a required field is the cheapest wire, and `null` is the
  // shell's honest answer when the snapshot read failed (ADD D-3).
  readonly bell: BellViewModel | null;

  readonly children: ReactNode;
}

function Brand({ size = 24 }: { readonly size?: number }) {
  return (
    <Link href={ROUTES.home} className={classes.brand} aria-label="Growthmind">
      <LogoMark size={size} />
      <LogoWordmark size={size * 0.58} />
    </Link>
  );
}

export function AppFrame({
  groups,
  viewer,
  organizations,
  activeOrganizationId,
  role,
  bell,
  children,
}: AppFrameProps) {
  const [opened, { toggle, close }] = useDisclosure(false);

  return (
    <AppShell navbar={{ width: 264, breakpoint: "sm", collapsed: { mobile: !opened } }} padding={0}>
      <AppShell.Navbar p={0} withBorder>
        <Box className={classes.rail}>
          <Box className={classes.railTop}>
            <Group px="md" py="md" wrap="nowrap" justify="space-between">
              <Brand />
              <BellErrorBoundary>
                <Bell bell={bell} placement="rail" />
              </BellErrorBoundary>
            </Group>
            <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
              <OrgSwitcher
                organizations={organizations}
                activeId={activeOrganizationId}
                activeName={viewer.organizationName}
                role={role}
              />
            </Box>
          </Box>

          <ScrollArea className={classes.railScroll} type="scroll">
            <AppNav groups={groups} onNavigate={close} />
          </ScrollArea>

          <Box className={classes.railBottom}>
            <UserMenu viewer={viewer} />
          </Box>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main>
        <Group hiddenFrom="sm" px="md" py="xs" gap="md" wrap="nowrap" style={HAIRLINE}>
          <Burger opened={opened} onClick={toggle} size="sm" aria-label="Menu" />
          <Brand size={22} />
          <Box ml="auto">
            <BellErrorBoundary>
              <Bell bell={bell} placement="bar" />
            </BellErrorBoundary>
          </Box>
        </Group>

        <Container size="lg" py="xl" px="lg">
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
