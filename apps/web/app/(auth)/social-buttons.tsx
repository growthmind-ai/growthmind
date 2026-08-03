"use client";

import { Button, Divider, Stack, Text } from "@mantine/core";
import { useState } from "react";

import { signIn } from "@/lib/auth-client";
import { ROUTES } from "@/lib/routes";
import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from "@/lib/social-auth";

const FAILED = "That sign-in did not complete. Try again, or use your email and password below.";

interface SocialButtonsProps {
  readonly providers: readonly SocialProviderId[];
}

export function SocialButtons({ providers }: SocialButtonsProps) {
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [failed, setFailed] = useState(false);

  // An installation with neither provider configured renders nothing at all — not a
  // disabled button, and not a divider with an empty space above it.
  if (providers.length === 0) return null;

  async function handleClick(provider: SocialProviderId) {
    if (pending !== null) return;

    setFailed(false);
    setPending(provider);
    try {
      // Hands the browser to the provider's consent screen; on success it comes back to
      // `callbackURL`, so there is no local navigation to perform here. `errorCallbackURL`
      // is the refusal path — without it, someone who changes their mind at the consent
      // screen lands on the auth handler's own error page, outside the app, with no way
      // back to the form they started from.
      const { error } = await signIn.social({
        provider,
        callbackURL: ROUTES.home,
        errorCallbackURL: ROUTES.signIn,
      });
      if (error) {
        setFailed(true);
        setPending(null);
      }
    } catch {
      setFailed(true);
      setPending(null);
    }
  }

  return (
    <Stack gap="md">
      <Stack gap="sm">
        {providers.map((provider) => (
          <Button
            key={provider}
            variant="default"
            size="md"
            fullWidth
            loading={pending === provider}
            disabled={pending !== null && pending !== provider}
            onClick={() => void handleClick(provider)}
          >
            Continue with {SOCIAL_PROVIDER_LABELS[provider]}
          </Button>
        ))}
      </Stack>
      {failed ? (
        <Text size="sm" c="red" ta="center">
          {FAILED}
        </Text>
      ) : null}
      <Divider label="or" labelPosition="center" />
    </Stack>
  );
}
