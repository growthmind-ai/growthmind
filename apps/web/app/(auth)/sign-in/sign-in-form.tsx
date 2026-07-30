"use client";

import { Anchor, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { signInSchema } from "@growthmind/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { signIn } from "@/lib/auth-client";
import { ROUTES } from "@/lib/routes";

// Copy is normative (UX spec §3, First-Run Checklist row 8) — shipped
// verbatim. Never surface a raw Zod message or a Better Auth error code.
const PENDING_LABEL = "Signing you in…";
const CREDENTIAL_MISMATCH_MESSAGE = "That email and password don't match — try again?";
const NETWORK_FAILURE_MESSAGE = "Couldn't reach the server — check your connection and try again.";

/**
 * Better Auth's `/sign-in/email` route throws the SAME code —
 * `INVALID_EMAIL_OR_PASSWORD` — whether the email is unknown or the
 * password is wrong (verified in `better-auth`'s `sign-in.mjs`), which is
 * exactly the "never reveal which was wrong" contract this form must honor.
 * Read defensively via `unknown`, mirroring `sign-up-form.tsx`'s helper.
 */
function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const body = (error as { body?: unknown }).body;
  if (body && typeof body === "object") {
    const bodyCode = (body as { code?: unknown }).code;
    if (typeof bodyCode === "string") {
      return bodyCode;
    }
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      // Belt: the button + fields are also disabled while pending, so this
      // guards only a synthetic/programmatic re-submit.
      return;
    }

    setFormError(null);
    setEmailError(null);
    setPasswordError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      // Client-side presence/format validation only — never the
      // wrong-credential case, so field-level display here does not
      // violate the "never reveal which was wrong" rule.
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "email") {
          setEmailError((current) => current ?? issue.message);
        } else if (field === "password") {
          setPasswordError((current) => current ?? issue.message);
        }
      }
      return;
    }

    setIsPending(true);
    try {
      const { error } = await signIn.email({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (!error) {
        router.push(ROUTES.home);
        return;
      }

      const code = readErrorCode(error);
      if (code === "INVALID_EMAIL_OR_PASSWORD") {
        setFormError(CREDENTIAL_MISMATCH_MESSAGE);
      } else {
        // Unknown/malformed failure and genuine network failure land on the
        // same plain-English message — neither a raw message nor a code
        // ever reaches the screen, and the credential message is reserved
        // for the exact case Better Auth confirms is a credential mismatch.
        setFormError(NETWORK_FAILURE_MESSAGE);
      }
    } catch {
      setFormError(NETWORK_FAILURE_MESSAGE);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          error={emailError}
          disabled={isPending}
          autoComplete="email"
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          error={passwordError}
          disabled={isPending}
          autoComplete="current-password"
        />
        {formError ? (
          <Text size="sm" c="red">
            {formError}
          </Text>
        ) : null}
        <Button type="submit" fullWidth loading={isPending}>
          {isPending ? PENDING_LABEL : "Sign in"}
        </Button>
        <Text size="sm" ta="center">
          New here?{" "}
          <Anchor component={Link} href={ROUTES.signUp}>
            Create an account
          </Anchor>
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          Growthmind is open source — github.com/growthmind-ai/growthmind
        </Text>
      </Stack>
    </form>
  );
}
