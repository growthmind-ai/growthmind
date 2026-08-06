import { Anchor, Badge, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";

import type { CompanyGroupDTO } from "@/lib/companies/dto";
import { ROUTES } from "@/lib/routes";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

function plural(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}s`;
}

export function CompanyRow({ group }: { readonly group: CompanyGroupDTO }) {
  return (
    <SurfaceCard>
      <Group justify="space-between" gap="md" wrap="wrap" align="flex-start">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Anchor
            component={Link}
            href={ROUTES.companyDetail.replace("[domain]", group.domain)}
            fw={600}
            truncate="end"
          >
            {group.domain}
          </Anchor>
          <Text size="xs" c="dimmed">
            Last active: {new Date(group.mostRecentSessionAt).toLocaleString()}
          </Text>
        </Stack>

        <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
          {plural(group.sessionCount, "session")}
        </Badge>
      </Group>
    </SurfaceCard>
  );
}
