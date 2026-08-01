// THE SURFACE'S OWN CHROME (O-008, AD-17).
//
// ###########################################################################
// # WHY A ROUTE GROUP EXISTS AT ALL.
// #
// # `(first-run)` is a directory whose name never appears in the URL, so the
// # surface can carry its own layout without buying a path segment. This is
// # the layout it was bought for: a thin header, a hairline, and nothing else.
// #
// # THERE IS NO NAVIGATION IN HERE, AND THERE NEVER WILL BE. `docs/mvp.md` §7
// # deviation 1: this surface exists once, during install, while the founder
// # is present. It holds no history and nothing links back to it — so a header
// # nav, a breadcrumb or a "back to setup" affordance would each be the
// # product decision broken by a change that looks like an improvement.
// #
// # The logo is DELIBERATELY NOT A LINK. Sign out is the one way out that
// # belongs in a header; everything else is a step in the sequence below.
// ###########################################################################
import { Box, Container, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/landing/sign-out-button";
import { LogoMark, LogoWordmark } from "@/components/ui/Logo";
import { FIRST_RUN_TITLE } from "@growthmind/shared";

/** The one rule under the header, drawn from the semantic border token. */
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
