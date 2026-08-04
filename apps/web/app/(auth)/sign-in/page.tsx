import { Stack, Title } from "@mantine/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_LOGIN_METHOD_COOKIE, resolveLastLoginBadge } from "@/lib/last-login-method";
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

  // Read here rather than from document.cookie in the button: the server would render no
  // badge and the browser would then add one, which is a hydration mismatch and a flash.
  const lastUsed = resolveLastLoginBadge(
    (await cookies()).get(LAST_LOGIN_METHOD_COOKIE)?.value,
    providers,
  );

  return (
    <Stack gap="lg">
      <Title order={1} size="h3" ta="center">
        Sign in
      </Title>
      <SocialButtons providers={providers} lastUsed={lastUsed} />
      <SignInForm lastUsed={lastUsed} />
    </Stack>
  );
}
