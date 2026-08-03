import { Box, Container, Group } from "@mantine/core";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/landing/sign-out-button";
import { AnchorLink } from "@/components/ui/Links";
import { LogoMark, LogoWordmark } from "@/components/ui/Logo";
import { ROUTES } from "@/lib/routes";

const HAIRLINE = { borderBottom: "1px solid var(--mantine-color-default-border)" };

interface SettingsLayoutProps {
  readonly children: ReactNode;
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <>
      <Box component="header" style={HAIRLINE}>
        <Container size="sm">
          <Group justify="space-between" wrap="nowrap" py="sm" gap="sm">
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
      {children}
    </>
  );
}
