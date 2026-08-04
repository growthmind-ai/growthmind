import { Box, Container, Group, Text } from "@mantine/core";

import { PreviewTabs } from "@/components/preview/PreviewTabs";
import { LogoMark, LogoWordmark } from "@/components/ui/Logo";
import { requirePreviewSession } from "@/lib/preview/guard";

export const dynamic = "force-dynamic";

export default async function PreviewLayout({ children }: { readonly children: React.ReactNode }) {
  await requirePreviewSession();

  return (
    <>
      <Box
        component="header"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Container size="lg" px="md">
          <Group justify="space-between" wrap="nowrap" py="xs" gap="md">
            <Group gap="xs" wrap="nowrap">
              <LogoMark size={24} />
              <LogoWordmark size={14} />
            </Group>
            <Text size="xs" c="dimmed" ta="right">
              Example content. Nothing here was measured from a real product.
            </Text>
          </Group>
          <PreviewTabs />
        </Container>
      </Box>

      <Container size="lg" py="lg" px="md">
        {children}
      </Container>
    </>
  );
}
