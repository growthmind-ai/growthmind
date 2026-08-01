import { Box, Center, Flex, Group, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { LogoMark, LogoWordmark } from "@/components/ui/Logo";

import { SpecimenMemo } from "./specimen-memo";

/**
 * Shared shell for the auth route group (ADD D-H / UX §3), now a two-pane
 * desk: the form on the left, a specimen memo on the right showing what
 * Growthmind actually delivers. The form column keeps its original ~400px
 * geometry and the pair sits vertically centered in the viewport, so nothing
 * about the sign-in ergonomics changed — the memo fills the half of a wide
 * screen the single column used to waste, and answers "what is this?" for a
 * visitor who arrived without prior context.
 *
 * Below `md` the row becomes a column: the form stays above the fold and the
 * memo follows it. The memo is never hidden — the persona most likely to need
 * it (someone who followed a link and doesn't know the product) is also the
 * one most likely to be on a phone.
 *
 * Sign-in and sign-up render inside this without inheriting any future
 * authenticated app chrome — that's the whole reason this route group exists.
 * The lockup and the imprint live here rather than in each page: both pages
 * had identical copies, and one shell is one place to change them.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Center mih="100dvh" p="md" py="xl">
      <Flex
        direction={{ base: "column", md: "row" }}
        align="center"
        justify="center"
        gap={{ base: 48, md: 64 }}
        w="100%"
      >
        <Box w="100%" maw={400}>
          <Stack gap="lg">
            <Group justify="center" gap="xs">
              <LogoMark size={30} />
              <LogoWordmark size={18} />
            </Group>

            {children}

            <Text ff="var(--mono)" fz={9} lts="0.16em" tt="uppercase" c="dimmed" ta="center">
              Open source · github.com/growthmind-ai/growthmind
            </Text>
          </Stack>
        </Box>

        <Box w="100%" maw={430}>
          <SpecimenMemo />
        </Box>
      </Flex>
    </Center>
  );
}
