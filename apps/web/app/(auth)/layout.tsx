import { Box, Center, Flex, Group, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { LogoMark, LogoWordmark } from "@/components/ui/Logo";

import { SpecimenMemo } from "./specimen-memo";

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
