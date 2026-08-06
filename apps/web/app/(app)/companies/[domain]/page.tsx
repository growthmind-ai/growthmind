import { Stack } from "@mantine/core";

import { CompanySessions } from "@/components/companies/CompanySessions";
import { AnchorLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;

  return (
    <Stack gap="lg">
      <PageHeader title={domain}>
        <AnchorLink href={ROUTES.companies}>Back to all companies</AnchorLink>
      </PageHeader>

      <CompanySessions domain={domain} />
    </Stack>
  );
}
