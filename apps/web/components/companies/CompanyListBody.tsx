import { Stack, Text } from "@mantine/core";

import { COMPANY_LIST_NONE_YET, COMPANY_LIST_TRUNCATED } from "@growthmind/shared";

import type { CompanyGroupDTO } from "@/lib/companies/dto";
import { CompanyRow } from "@/components/companies/CompanyRow";
import { LoadingSkeletonStack } from "@/components/ui/LoadingSkeletonStack";

export type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly groups: CompanyGroupDTO[]; readonly truncated: boolean }
  | { readonly state: "failed"; readonly message: string };

export function CompanyListBody({ load }: { readonly load: Load }) {
  if (load.state === "loading") {
    return <LoadingSkeletonStack />;
  }

  if (load.state === "failed") {
    return <Text c="dimmed">{load.message}</Text>;
  }

  if (load.groups.length === 0) {
    return <Text c="dimmed">{COMPANY_LIST_NONE_YET}</Text>;
  }

  return (
    <Stack gap="sm">
      {load.groups.map((group) => (
        <CompanyRow key={group.domain} group={group} />
      ))}

      {load.truncated ? (
        <Text size="sm" c="dimmed">
          {COMPANY_LIST_TRUNCATED}
        </Text>
      ) : null}
    </Stack>
  );
}
