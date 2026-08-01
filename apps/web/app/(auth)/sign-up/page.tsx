import { Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

import { SignUpForm } from "./sign-up-form";

/**
 * Server component (agents.md convention; ): a signed-in visitor must never land here
 * and accidentally create a second account (UX / First-Run edge case table), so the
 * redirect happens before anything renders. Client form logic lives entirely in the
 * sibling `"use client"` component.
 *
 * The lockup and the open-source imprint are the layout's. This page owns only what
 * distinguishes it from sign-in.
 */
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
