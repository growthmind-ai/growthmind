import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { AnchorLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { ROUTES } from "@/lib/routes";

interface StartInChannelProps {
  readonly title: string;
  readonly children: ReactNode;
}

/** The empty state of a loop step: it names why it is empty and hands back to step one. */
export function StartInChannel({ title, children }: StartInChannelProps) {
  return (
    <Stack gap="md">
      <PageHeader title={title} />
      <Text c="dimmed">
        {children} <AnchorLink href={ROUTES.channel}>Start in your channel.</AnchorLink>
      </Text>
    </Stack>
  );
}
