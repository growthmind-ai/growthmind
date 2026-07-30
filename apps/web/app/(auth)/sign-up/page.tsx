import { Group, Stack, Title } from "@mantine/core";
import { redirect } from "next/navigation";

import { LogoMark, LogoWordmark } from "@/components/ui/Logo";
import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

import { SignUpForm } from "./sign-up-form";

/**
 * Server component (AGENTS.md convention; ADD D-G): a signed-in visitor
 * must never land here and accidentally create a second account (UX §7 /
 * First-Run edge case table), so the redirect happens before anything
 * renders. Client form logic lives entirely in the sibling `"use client"`
 * component.
 */
export default async function SignUpPage() {
  const tenantContext = await getTenantContext();
  if (tenantContext) {
    redirect(ROUTES.home);
  }

  return (
    <Stack gap="lg">
      <Group justify="center" gap="xs">
        <LogoMark size={30} />
        <LogoWordmark size={18} />
      </Group>
      <Title order={1} size="h3" ta="center">
        Create your account
      </Title>
      <SignUpForm />
    </Stack>
  );
}
