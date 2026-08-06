import { Stack, Text, Title } from "@mantine/core";

import { CompanySessions } from "@/components/companies/CompanySessions";
import { AnchorLink } from "@/components/ui/Links";
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
      {/* Not PageHeader: passing the domain through its title prop would trip
          replay-attribute-exposure.test.ts's scan, though Mantine's Title renders it as masked
          text, never an HTML attribute. Inlined to avoid the false match without mislabeling
          customer data as "our-copy". */}
      <Stack gap={2}>
        <Title order={1} size="h3">
          {domain}
        </Title>
        <Text size="sm" c="dimmed">
          <AnchorLink href={ROUTES.companies}>Back to all companies</AnchorLink>
        </Text>
      </Stack>

      <CompanySessions domain={domain} />
    </Stack>
  );
}
