import { Box, Container, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { SETTINGS_TITLE } from "@growthmind/shared";

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
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" c="dimmed">
                {SETTINGS_TITLE}
              </Text>
              <SignOutButton />
            </Group>
          </Group>
        </Container>
      </Box>
      {children}
    </>
  );
}
