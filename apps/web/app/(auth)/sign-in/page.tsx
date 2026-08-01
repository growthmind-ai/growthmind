import { Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

import { SignInForm } from "./sign-in-form";

/**
 * Server component (AGENTS.md convention; ADD D-G): a signed-in visitor
 * must never land here (UX §1 redirect contract) — the redirect happens
 * before anything renders. Client form logic lives entirely in the sibling
 * `"use client"` component. Mirrors `app/(auth)/sign-up/page.tsx` exactly.
 *
 * The lockup and the open-source imprint are the layout's — this page owns
 * only what distinguishes it from sign-up.
 */
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
