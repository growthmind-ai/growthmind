import { Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const tenantContext = await getTenantContext();
  if (tenantContext) {
    redirect(ROUTES.home);
  }

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Create your account
      </Title>
      <SignUpForm />
    </Stack>
  );
}
