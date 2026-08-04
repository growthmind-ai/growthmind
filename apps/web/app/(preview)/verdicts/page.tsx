import { Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readVerdicts } from "@/lib/preview/readers";
import { verdictPath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

export default function VerdictsPage() {
  const first = readVerdicts()[0];

  if (first !== undefined) {
    redirect(verdictPath(first.findingId));
  }

  return (
    <Stack gap="md">
      <Title order={1} size="h3">
        Nothing has been read out yet
      </Title>
      <Text c="dimmed">
        A verdict appears here once a fix reaches its readout date.{" "}
        <Link href="/channel">Start in your channel.</Link>
      </Text>
    </Stack>
  );
}
