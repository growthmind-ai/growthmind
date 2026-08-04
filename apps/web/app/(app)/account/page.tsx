import { Avatar, Group, Stack, Text } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/landing/sign-out-button";
import { AnchorLink } from "@/components/ui/Links";
import { PageHeader, RuledRow } from "@/components/ui/Page";
import { getAuth } from "@/lib/auth";
import { initialsOf } from "@/lib/initials";
import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const tenant = await getTenantContext();
  if (tenant === null) {
    redirect(ROUTES.signIn);
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  const name = session?.user.name?.trim() ?? "";
  const email = session?.user.email ?? null;

  return (
    <Stack gap="lg" maw={640}>
      <PageHeader title="Your profile">
        Who you are signed in as, and which workspace you are looking at.
      </PageHeader>

      <Group gap="md" wrap="nowrap">
        <Avatar radius="xl" size={56} color="band" variant="light">
          <Text fw={700}>{initialsOf(name, email)}</Text>
        </Avatar>
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fw={600} size="lg" truncate>
            {name.length > 0 ? name : (email ?? "Signed in")}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            {email ?? "No email on this account"}
          </Text>
        </Stack>
      </Group>

      <Stack gap={0}>
        <RuledRow lead={<Text c="dimmed">Workspace</Text>} leadWidth={130}>
          <Text>{tenant.organizationName}</Text>
        </RuledRow>
        <RuledRow lead={<Text c="dimmed">Your role</Text>} leadWidth={130}>
          <Text tt="capitalize">{tenant.role}</Text>
        </RuledRow>
        <RuledRow lead={<Text c="dimmed">Sign-in</Text>} leadWidth={130}>
          <Text>{email ?? "—"}</Text>
        </RuledRow>
      </Stack>

      {/* Renaming the workspace lives on the home page and changing a connection lives in
          settings; this page points at both rather than growing a second control for either. */}
      <Text size="sm" c="dimmed">
        Connections, delivery and exclusions are in{" "}
        <AnchorLink href={ROUTES.settings} size="sm">
          settings
        </AnchorLink>
        . There is no way to change your name or email yet — reply to any finding and we will do it.
      </Text>

      <Group>
        <SignOutButton />
      </Group>
    </Stack>
  );
}
