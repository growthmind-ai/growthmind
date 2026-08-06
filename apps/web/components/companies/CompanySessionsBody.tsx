import { Skeleton, Stack, Text } from "@mantine/core";

import { COMPANY_DETAIL_NOT_FOUND, COMPANY_SESSIONS_TRUNCATED } from "@growthmind/shared";

import { CompanySessionRow } from "@/components/companies/CompanySessionRow";
import type { CompanySessionDTO } from "@/lib/companies/dto";

export type Load =
  | { readonly state: "loading" }
  | { readonly state: "not_found" }
  | { readonly state: "ready"; readonly sessions: CompanySessionDTO[]; readonly truncated: boolean }
  | { readonly state: "failed"; readonly message: string };

export function CompanySessionsBody({ load }: { readonly load: Load }) {
  if (load.state === "loading") {
    return (
      <Stack gap="sm">
        <Skeleton height={72} radius="md" />
        <Skeleton height={72} radius="md" />
      </Stack>
    );
  }

  if (load.state === "not_found") {
    return <Text c="dimmed">{COMPANY_DETAIL_NOT_FOUND}</Text>;
  }

  if (load.state === "failed") {
    return <Text c="dimmed">{load.message}</Text>;
  }

  // The detail route 404s rather than returning zero sessions, so "ready" never needs an
  // empty-state branch here (unlike the list page's CompanyListBody).
  return (
    <Stack gap="sm">
      {load.sessions.map((session) => (
        <CompanySessionRow key={session.sessionId} session={session} />
      ))}

      {load.truncated ? (
        <Text size="sm" c="dimmed">
          {COMPANY_SESSIONS_TRUNCATED}
        </Text>
      ) : null}
    </Stack>
  );
}
