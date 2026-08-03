import { Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { configuredSocialProviders } from "@/lib/social-auth";
import { getTenantContext } from "@/lib/tenant";

import { SocialButtons } from "../social-buttons";
import { SignInForm } from "./sign-in-form";

// Which providers exist is a RUNTIME fact. Prerendered, this screen would bake in whatever
// was configured on the build machine and keep showing it after the deployment changed.
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const tenantContext = await getTenantContext();
  if (tenantContext) {
    redirect(ROUTES.home);
  }

  // Resolved here, server-side, and handed down as a list. The button must never read the
  // credentials itself: a NEXT_PUBLIC_ twin would publish them to every browser.
  const providers = configuredSocialProviders(process.env);

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Sign in
      </Title>
      <SocialButtons providers={providers} />
      <SignInForm />
    </Stack>
  );
}
