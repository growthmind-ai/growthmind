import { Box, Container, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/landing/sign-out-button";
import { LogoMark, LogoWordmark } from "@/components/ui/Logo";
import { FIRST_RUN_TITLE } from "@growthmind/shared";

const HAIRLINE = { borderBottom: "1px solid var(--mantine-color-default-border)" };

interface FirstRunLayoutProps {
  readonly children: ReactNode;
}

export default function FirstRunLayout({ children }: FirstRunLayoutProps) {
  return (
    <>
      <Box component="header" style={HAIRLINE}>
        <Container size="sm">
          <Group justify="space-between" wrap="nowrap" py="sm" gap="sm">
            <Group gap="xs" wrap="nowrap">
              <LogoMark size={28} />
              <LogoWordmark size={16} />
            </Group>
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" c="dimmed">
                {FIRST_RUN_TITLE}
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
