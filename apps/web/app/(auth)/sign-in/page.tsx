import { Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const tenantContext = await getTenantContext();
  if (tenantContext) {
    redirect(ROUTES.home);
  }

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Sign in
      </Title>
      <SignInForm />
    </Stack>
  );
}
