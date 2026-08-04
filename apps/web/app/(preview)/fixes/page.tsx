import { Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readFixes } from "@/lib/preview/readers";
import { fixPath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

export default function FixesPage() {
  const fixes = readFixes();
  const first = fixes[0];

  // One fix exists in the example content, so the tab goes straight to it rather than
  // offering a list of one — a list here would be the queue the product refuses to be.
  if (first !== undefined) {
    redirect(fixPath(first.findingId));
  }

  return (
    <Stack gap="md">
      <Title order={1} size="h3">
        Nothing has been sent to your agent yet
      </Title>
      <Text c="dimmed">
        A fix appears here once you ask for one. <Link href="/channel">Start in your channel.</Link>
      </Text>
    </Stack>
  );
}
