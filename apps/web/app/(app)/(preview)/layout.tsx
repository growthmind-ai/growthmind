import { Box, Text } from "@mantine/core";

import { requirePreviewSession } from "@/lib/preview/guard";

export const dynamic = "force-dynamic";

// The nine surfaces still running on example content sit under one group so the allow-list
// guard has a single home, and so the disclaimer cannot be forgotten on a new one. Settings
// and the profile are real, and live outside it.
export default async function PreviewLayout({ children }: { readonly children: React.ReactNode }) {
  await requirePreviewSession();

  return (
    <>
      <Box
        pb="xs"
        mb="lg"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Text size="xs" c="dimmed">
          Example content. Nothing on this page was measured from a real product.
        </Text>
      </Box>
      {children}
    </>
  );
}
