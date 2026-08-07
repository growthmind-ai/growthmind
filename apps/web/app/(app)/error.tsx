"use client";

import { Button, Stack, Text, Title } from "@mantine/core";
import { useEffect } from "react";

import { logger } from "@growthmind/shared";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { tapTargetStyle } from "@/components/ui/tap-target";

// Inside the (app) group rather than at the app root, so a page that throws keeps the rail,
// the workspace switcher and every other route. Without it Next renders its own screen and
// the reader loses the shell along with the page.
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // The digest is Next's own correlation id for the server-side stack, which never reaches
    // the browser. It is the only way to tie what a person saw to what was logged.
    logger.error("app: a page could not be rendered", { digest: error.digest ?? null });
  }, [error]);

  return (
    <Stack gap="lg" maw={640}>
      <Title order={1} size="h2">
        This page did not load
      </Title>

      <SurfaceCard>
        <Stack gap="sm">
          {/* Ours, not theirs, and said in the first sentence: a reader who thinks they broke
              it goes looking for what they did wrong. Never the thrown message — it carries
              table names and vendor text no customer should read. */}
          <Text>
            Something on our side failed while putting this page together. Nothing you did caused
            it, and nothing has been lost — this is a page that could not be drawn, not work that
            went missing.
          </Text>
          <Text c="dimmed" size="sm">
            Everything else still works. The rest of the app is in the rail beside this.
          </Text>
        </Stack>
      </SurfaceCard>

      <Stack gap="xs" align="flex-start">
        <Button onClick={reset} size="md" style={tapTargetStyle}>
          Try again
        </Button>
        <Text c="dimmed" size="sm">
          If it keeps happening, tell us — a page that will not load twice is worth knowing about.
        </Text>
      </Stack>
    </Stack>
  );
}
