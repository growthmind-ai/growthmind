"use client";

import { Button } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { tapTargetStyle } from "@/components/ui/tap-target";

import { signOut } from "../../lib/auth-client";
import { ROUTES } from "../../lib/routes";

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
