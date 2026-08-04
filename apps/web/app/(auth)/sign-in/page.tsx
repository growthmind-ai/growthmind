import { Stack, Title } from "@mantine/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readSignInEmail, SIGN_IN_EMAIL_PARAM } from "@/lib/auth-forms";
import { LAST_LOGIN_METHOD_COOKIE, resolveLastLoginBadge } from "@/lib/last-login-method";
import { ROUTES } from "@/lib/routes";
import { configuredSocialProviders } from "@/lib/social-auth";
import { getTenantContext } from "@/lib/tenant";

import { SocialButtons } from "../social-buttons";
import { SignInForm } from "./sign-in-form";

// Which providers exist is a runtime fact; prerendering would bake in the build machine's.
export const dynamic = "force-dynamic";

interface SignInPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const tenantContext = await getTenantContext();
  if (tenantContext) {
    redirect(ROUTES.home);
  }

  // Server-side: a NEXT_PUBLIC_ twin would publish the credentials to every browser.
  const providers = configuredSocialProviders(process.env);

  // Read here, not from document.cookie: a browser-added badge is a hydration mismatch.
  const lastUsed = resolveLastLoginBadge(
    (await cookies()).get(LAST_LOGIN_METHOD_COOKIE)?.value,
    providers,
  );

  const initialEmail = readSignInEmail((await searchParams)[SIGN_IN_EMAIL_PARAM]);

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Sign in
      </Title>
      <SocialButtons providers={providers} lastUsed={lastUsed} />
      <SignInForm lastUsed={lastUsed} initialEmail={initialEmail} />
    </Stack>
  );
}
