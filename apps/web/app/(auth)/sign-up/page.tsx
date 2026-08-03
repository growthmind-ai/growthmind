import { Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { configuredSocialProviders } from "@/lib/social-auth";
import { getTenantContext } from "@/lib/tenant";

import { SocialButtons } from "../social-buttons";
import { SignUpForm } from "./sign-up-form";

// Same reason as the sign-in screen: the provider list is a runtime fact, not a build one.
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const tenantContext = await getTenantContext();
  if (tenantContext) {
    redirect(ROUTES.home);
  }

  // Better Auth's social path signs up and signs in through one call, so the same control
  // serves both screens; a separate "sign up with" button would be the same request.
  const providers = configuredSocialProviders(process.env);

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Create your account
      </Title>
      <SocialButtons providers={providers} />
      <SignUpForm />
    </Stack>
  );
}
