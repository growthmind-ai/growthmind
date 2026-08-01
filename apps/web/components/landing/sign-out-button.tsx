"use client";

import { Button } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { tapTargetStyle } from "@/components/ui/tap-target";

import { signOut } from "../../lib/auth-client";
import { ROUTES } from "../../lib/routes";

/**
 * Flow C: Landing → "Sign out" → `/sign-in`. Better Auth's client `signOut`
 * clears the session; the redirect is our own (no middleware), so it runs after the
 * client call resolves rather than relying on `fetchOptions.onSuccess` alone.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut();
    router.push(ROUTES.signIn);
  }

  return (
    <Button
      variant="subtle"
      color="gray"
      onClick={handleSignOut}
      loading={pending}
      disabled={pending}
      style={tapTargetStyle}
    >
      Sign out
    </Button>
  );
}
