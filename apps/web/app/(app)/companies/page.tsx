import { Stack } from "@mantine/core";

import { CompanyList } from "@/components/companies/CompanyList";
import { PageHeader } from "@/components/ui/Page";

export const dynamic = "force-dynamic";

export default function CompaniesPage() {
  return (
    <Stack gap="lg">
      <PageHeader title="Companies">
        Sessions grouped by company email domain. Personal email providers like Gmail and Yahoo
        aren&apos;t shown here, since they don&apos;t represent one company.
      </PageHeader>

      <CompanyList />
    </Stack>
  );
}
