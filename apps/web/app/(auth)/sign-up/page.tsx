import { Stack, Title } from "@mantine/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_LOGIN_METHOD_COOKIE, resolveLastLoginBadge } from "@/lib/last-login-method";
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

  // Someone who already has an account and landed here anyway gets told which button is
  // theirs, instead of making a second one. The form below stays unbadged: it creates.
  const lastUsed = resolveLastLoginBadge(
    (await cookies()).get(LAST_LOGIN_METHOD_COOKIE)?.value,
    providers,
  );

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Create your account
      </Title>
      <SocialButtons providers={providers} lastUsed={lastUsed} />
      <SignUpForm />
    </Stack>
  );
}
